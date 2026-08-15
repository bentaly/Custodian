import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import {
  applications,
  awardInstalments,
  awards,
  programmes,
  rounds,
  roundProgrammes,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { DUE_SOON_DAYS, addDaysIso, todayIso } from '../../lib/schedule'

/**
 * The Finance list, expressed as SQL.
 *
 * Finance used to load every award, application, programme and instalment in the
 * tenant on every page view, roll them up in the Worker, and slice 25 rows off the
 * result. That is O(the foundation's whole history) per page turn, and the two things
 * that made it feel necessary — a row's *status* being derived, and the KPIs being
 * counted over the whole filtered set — are both things Postgres is better at than we
 * are. `src/lib/pagination.ts` sets out the convention; this is Finance meeting it.
 *
 * The shape is two nested subqueries:
 *
 *   roll    — one row per award: the instalment set reduced to money and dates.
 *   grants  — one row per grant: application ⋈ award ⋈ roll, with `status` derived
 *             from those aggregates, so it can be filtered, sorted and counted in SQL
 *             like any other column.
 *
 * `grants` is built once and reused by the rows page, the totals and every facet, so
 * a KPI and the table underneath it cannot be computed from different definitions —
 * which is the property the old single-array version had for free and the one most
 * worth keeping. They are also sent in one `db.batch()` (neon-http has no interactive
 * transactions), so the whole screen is ONE round trip against ONE snapshot: no
 * chance of a payment landing between the count and the rows.
 *
 * The bank check was the last thing here that SQL could not answer — it is a modulus
 * algorithm, not an expression. It is now stored on the application by whichever write
 * set the numbers (`server/applications/bank.ts`), so the column sorts and the
 * portfolio-wide issue count is a `count(*) filter (...)` like any other.
 */

type Db = ReturnType<typeof getDb>

/** ISO day strings compare correctly as text, which is why the date columns are `text`. */
export type FinanceDates = { today: string; soonCutoff: string }

export function financeDates(): FinanceDates {
  const today = todayIso()
  return { today, soonCutoff: addDaysIso(today, DUE_SOON_DAYS) }
}

/**
 * One row per award: the instalment set reduced to what Finance asks of it.
 *
 * `next_*` is the earliest unpaid instalment under the same ordering the payment
 * schedule uses — dated ones first, then by date, then by instalment number, so a
 * "TBC" instalment is outstanding money that cannot be chased on a date. Postgres has
 * no argmin, so it is an ordered `array_agg` of the unpaid rows with the first taken;
 * the alternative (a lateral join per award) reads worse and costs more.
 */
function instalmentRollup(db: Db, { today, soonCutoff }: FinanceDates) {
  const unpaid = sql`${awardInstalments.paidDate} is null`
  const nextOrder = sql`order by (${awardInstalments.dueDate} is null), ${awardInstalments.dueDate}, ${awardInstalments.instalmentNo}`
  const overdue = sql`${unpaid} and ${awardInstalments.dueDate} < ${today}`
  const dueSoon = sql`${unpaid} and ${awardInstalments.dueDate} >= ${today} and ${awardInstalments.dueDate} <= ${soonCutoff}`

  return db
    .select({
      awardId: awardInstalments.awardId,
      instalmentCount: sql<number>`(count(*))::int`.as('instalment_count'),
      paidCount:
        sql<number>`(count(*) filter (where ${awardInstalments.paidDate} is not null))::int`.as(
          'paid_count',
        ),
      unpaidCount: sql<number>`(count(*) filter (where ${unpaid}))::int`.as('unpaid_count'),
      paidTotal:
        sql<number>`coalesce(sum(${awardInstalments.amount}) filter (where ${awardInstalments.paidDate} is not null), 0)::float8`.as(
          'paid_total',
        ),
      scheduledTotal: sql<number>`coalesce(sum(${awardInstalments.amount}), 0)::float8`.as(
        'scheduled_total',
      ),
      lastPaidDate: sql<string | null>`max(${awardInstalments.paidDate})`.as('last_paid_date'),
      nextDueDate: sql<
        string | null
      >`(array_agg(${awardInstalments.dueDate} ${nextOrder}) filter (where ${unpaid}))[1]`.as(
        'next_due_date',
      ),
      nextAmount: sql<
        number | null
      >`((array_agg(${awardInstalments.amount} ${nextOrder}) filter (where ${unpaid}))[1])::float8`.as(
        'next_amount',
      ),
      nextId: sql<
        string | null
      >`(array_agg(${awardInstalments.id} ${nextOrder}) filter (where ${unpaid}))[1]`.as('next_id'),
      overdueCount: sql<number>`(count(*) filter (where ${overdue}))::int`.as('overdue_count'),
      overdueAmount:
        sql<number>`coalesce(sum(${awardInstalments.amount}) filter (where ${overdue}), 0)::float8`.as(
          'overdue_amount',
        ),
      dueSoonCount: sql<number>`(count(*) filter (where ${dueSoon}))::int`.as('due_soon_count'),
      dueSoonAmount:
        sql<number>`coalesce(sum(${awardInstalments.amount}) filter (where ${dueSoon}), 0)::float8`.as(
          'due_soon_amount',
        ),
    })
    .from(awardInstalments)
    .groupBy(awardInstalments.awardId)
    .as('roll')
}

/**
 * One row per grant, with `status` derived in SQL.
 *
 * This CASE is the single definition of where a grant's money is up to — the same
 * ladder the old `summarisePayments` walked, in the same order, and the vocabulary it
 * produces (`FinanceStatus`) is still labelled and coloured in TS. Deriving it here is
 * what lets the Status pill, the column sort, the tab split and the facet counts all
 * be one query instead of four passes over a materialised array.
 *
 * A cancelled grant is `cancelled` whatever its schedule still says: there is nothing
 * left to chase. A grant with no instalments at all is `unscheduled` — money promised
 * with no plan to pay it, which is a finance problem in its own right rather than a
 * quiet zero.
 */
export function grantsQuery(db: Db, scope: string[] | null, dates: FinanceDates) {
  const roll = instalmentRollup(db, dates)
  const committed = sql<number>`${awards.amountAwarded}::float8`
  const paidTotal = sql<number>`coalesce(${roll.paidTotal}, 0)`

  const status = sql<string>`case
    when ${awards.status} = 'cancelled' then 'cancelled'
    when coalesce(${roll.instalmentCount}, 0) = 0 then 'unscheduled'
    when coalesce(${roll.unpaidCount}, 0) = 0 then 'paid'
    when coalesce(${roll.overdueCount}, 0) > 0 then 'overdue'
    when coalesce(${roll.dueSoonCount}, 0) > 0 then 'due_soon'
    else 'scheduled'
  end`

  return db
    .select({
      // Every column is explicitly aliased. A subquery projecting `awards.id` and
      // `applications.id` publishes two columns called `id`, and the outer query's
      // reference to either is then ambiguous — which Postgres reports at runtime, long
      // after the types have said yes.
      awardId: sql<string>`${awards.id}`.as('award_id'),
      applicationId: sql<string>`${applications.id}`.as('application_id'),
      organisationName: sql<string>`${applications.organisationName}`.as('organisation_name'),
      programmeId: sql<string | null>`${roundProgrammes.programmeId}`.as('programme_id'),
      programmeName: sql<string | null>`${programmes.name}`.as('programme_name'),
      roundId: sql<string | null>`${roundProgrammes.roundId}`.as('round_id'),
      roundName: sql<string | null>`${rounds.name}`.as('round_name'),
      tags: sql<unknown>`${programmes.tags}`.as('tags'),
      awardStatus: sql<string>`${awards.status}`.as('award_status'),
      // The account number is here because the column shows its last four. The verdict
      // beside it is the STORED one (`lib/bankVerification`'s `bankStatus`, written by
      // `bankFields()` on every path that sets the numbers) — which is what makes the
      // Bank column sortable and `bankIssueCount` countable without running a modulus
      // algorithm over every grant in the tenant. NULL on rows written before the
      // column existed; `bankRank` puts those last rather than guessing.
      bankAccountNumber: sql<string | null>`${applications.bankAccountNumber}`.as(
        'bank_account_number',
      ),
      bankStatus: sql<string | null>`${applications.bankCheckStatus}`.as('bank_check_status'),
      committed: committed.as('committed'),
      paidTotal: paidTotal.as('paid_to_date'),
      // Outstanding is measured against what was COMMITTED, not against the instalment
      // plan: an unscheduled or short-scheduled grant still owes the difference, and
      // that gap is exactly what finance cares about. Cancelled grants owe nothing.
      outstanding: sql<number>`case when ${awards.status} = 'cancelled' then 0
        else ${committed} - ${paidTotal} end`.as('outstanding'),
      instalmentCount: sql<number>`coalesce(${roll.instalmentCount}, 0)`.as('instalment_count'),
      paidCount: sql<number>`coalesce(${roll.paidCount}, 0)`.as('paid_count'),
      scheduledTotal: sql<number>`coalesce(${roll.scheduledTotal}, 0)`.as('scheduled_total'),
      lastPaidDate: roll.lastPaidDate,
      nextId: roll.nextId,
      nextDueDate: roll.nextDueDate,
      nextAmount: roll.nextAmount,
      // A cancelled grant sorts as dateless for the same reason it has no status of its
      // own: it is not a payment due long ago, it is not a payment at all.
      chaseDate: sql<
        string | null
      >`case when ${awards.status} = 'cancelled' then null else ${roll.nextDueDate} end`.as(
        'chase_date',
      ),
      overdueCount: sql<number>`coalesce(${roll.overdueCount}, 0)`.as('overdue_count'),
      overdueAmount: sql<number>`coalesce(${roll.overdueAmount}, 0)`.as('overdue_amount'),
      dueSoonCount: sql<number>`coalesce(${roll.dueSoonCount}, 0)`.as('due_soon_count'),
      dueSoonAmount: sql<number>`coalesce(${roll.dueSoonAmount}, 0)`.as('due_soon_amount'),
      status: status.as('status'),
    })
    .from(applications)
    .innerJoin(awards, eq(awards.applicationId, applications.id))
    .leftJoin(roll, eq(roll.awardId, awards.id))
    .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
    .leftJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
    .where(
      and(
        eq(applications.status, 'awarded'),
        // `null` scope is superadmin — unrestricted. An empty array never reaches here;
        // the caller short-circuits, because `inArray(x, [])` is a SQL error.
        scope ? inArray(applications.roundProgrammeId, scope) : undefined,
      ),
    )
    .as('grants')
}

export type GrantsQuery = ReturnType<typeof grantsQuery>

/**
 * A column of the `grants` subquery, qualified by hand.
 *
 * Drizzle emits a reference to an ALIASED subquery field bare — `"award_id"`, not
 * `"grants"."award_id"`. Inside a query whose FROM is only `grants` that is fine, and
 * every filter and sort here relies on it. The moment `grants` is joined to a table
 * carrying the same column name — `award_instalments` has an `award_id` too — Postgres
 * rejects the whole statement as ambiguous, at runtime, with the types perfectly happy.
 * So any reference to `grants` from a joined query goes through this.
 */
export function grantsCol(name: string): SQL {
  return sql.raw(`"grants"."${name}"`)
}

/** A page of grants. Exported as a type so the mapper to the screen's row can be typed. */
export function grantRows(db: Db, g: GrantsQuery) {
  return db.select().from(g)
}
export type GrantRow = Awaited<ReturnType<typeof grantRows>>[number]

/** Which tab a grant belongs to. Every grant is on exactly one, so the two are exhaustive. */
export function tabWhere(g: GrantsQuery, tab: 'to_pay' | 'paid'): SQL {
  const settled = sql`${g.status} in ('paid', 'cancelled')`
  return tab === 'paid' ? settled : sql`not (${settled})`
}

/**
 * The transient filters — everything the pills and the date range say.
 *
 * The date window runs against the payment date the open tab is ABOUT: the next
 * payment due when you are paying, the last one made when you are reconciling. One
 * control whose meaning follows the tab, which is why the column is chosen here
 * rather than passed in.
 */
export function filterWhere(
  g: GrantsQuery,
  tab: 'to_pay' | 'paid',
  f: {
    roundId?: string
    programmeId?: string
    tag?: string
    status?: string
    from?: string
    to?: string
  },
): SQL | undefined {
  const day = tab === 'paid' ? g.lastPaidDate : g.chaseDate
  return and(
    f.roundId ? eq(g.roundId, f.roundId) : undefined,
    f.programmeId ? eq(g.programmeId, f.programmeId) : undefined,
    f.tag ? sql`${g.tags} @> ${JSON.stringify([f.tag])}::jsonb` : undefined,
    f.status ? eq(g.status, f.status) : undefined,
    // A row with no date at all is outside any window — it cannot be shown to be inside
    // one, and showing it anyway would make the filter mean "or unknown".
    f.from ? sql`${day} >= ${f.from}` : undefined,
    f.to ? sql`${day} <= ${f.to}` : undefined,
  )
}
