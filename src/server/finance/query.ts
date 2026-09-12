import { and, eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import {
  applications,
  awardInstalments,
  awards,
  programmes,
  rounds,
  roundProgrammes,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { searchAny } from '../searchTerm'
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
 *
 * A cancelled grant that never paid a penny is not here at all — see the WHERE.
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
      /** The foundation's own reference — the row's subtext, and a column in the export. */
      externalApplicationId: sql<string | null>`${applications.externalApplicationId}`.as(
        'external_application_id',
      ),
      programmeId: sql<string | null>`${roundProgrammes.programmeId}`.as('programme_id'),
      programmeName: sql<string | null>`${programmes.name}`.as('programme_name'),
      roundId: sql<string | null>`${roundProgrammes.roundId}`.as('round_id'),
      roundName: sql<string | null>`${rounds.name}`.as('round_name'),
      // The application's own themes, not its programme's whole list.
      tags: sql<unknown>`${applications.themes}`.as('tags'),
      awardStatus: sql<string>`${awards.status}`.as('award_status'),
      // Provenance, not status: a grant carried in by the onboarding import keeps its
      // batch id for good, and the row says so — see `ui/ImportedPill` for why the
      // blanks on an imported grant have to read as history rather than as loss.
      imported: sql<boolean>`${awards.importBatchId} is not null`.as('imported'),
      // The verdict here is the STORED one (`lib/bankVerification`'s `bankStatus`,
      // written by `bankFields()` on every path that sets the numbers) — which is what
      // makes the Valid column sortable and filterable, and `bankIssueCount` countable,
      // without running a modulus algorithm over every grant in the tenant. NULL on rows
      // written before the column existed; `bankVerdict` reads those as `unchecked` and
      // `bankRank` sorts them with the clean ones rather than guessing.
      bankAccountNumber: sql<string | null>`${applications.bankAccountNumber}`.as(
        'bank_account_number',
      ),
      // The account name and sort code ride along for the CSV export only — the list
      // itself shows neither. `listFinanceGrants` drops them from the row unless the
      // caller asked for a payable file, so a page view still carries no payable pair.
      bankAccountName: sql<string | null>`${applications.bankAccountName}`.as('bank_account_name'),
      bankSortCode: sql<string | null>`${applications.bankSortCode}`.as('bank_sort_code'),
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
        // Finance is a payments lens, so a cancelled grant is here only when money has
        // already left — the paid history still has to reconcile. One that was pulled
        // before a penny moved has no payment to show and nothing left to pay: it drew
        // a row on the **Paid** tab reading `Paid —` with a blank last payment, which
        // reads as a fault rather than a state, and it inflated that tab's count with a
        // grant no payment run will ever touch. It stays on **Awards**, which is the
        // register of decisions — cancelling one is a decision, not a payment.
        //
        // The OUTER PARENTHESES are load-bearing, and their absence was a cross-tenant
        // leak. `and()` wraps the whole list in one pair of brackets but does not
        // bracket each member, so a raw `or` escapes its own term and `AND`'s tighter
        // binding re-associates the entire clause into
        //   (status = 'awarded' AND awards.status <> 'cancelled')
        //   OR (paid_total > 0 AND round_programme_id IN <scope>)
        // — which left the scope filter on one branch only. Every foundation's awarded
        // grants therefore appeared on every other foundation's Finance screen, and the
        // CSV export carries payable bank details. Any raw `or` handed to `and()` must
        // bracket itself; Drizzle's own `or()` helper does it, a template string cannot.
        sql`(${awards.status} <> 'cancelled' or coalesce(${roll.paidTotal}, 0) > 0)`,
        // `null` scope is superadmin — unrestricted. An empty array never reaches here;
        // the caller short-circuits, because `inArray(x, [])` is a SQL error.
        scope ? inArray(applications.roundProgrammeId, scope) : undefined,
      ),
    )
    .as('grants')
}

export type GrantsQuery = ReturnType<typeof grantsQuery>

/**
 * One row per PAYMENT — the Finance table itself.
 *
 * Finance is a payment-run screen, and for a long time its row was a grant: Inspire
 * Youth Zone appeared once, owing £19,460, when what it actually has is two instalments
 * of £9,730 twelve months apart. The second payment was only visible by opening the row.
 * The Upcoming payments panel above the table had already conceded the point — it lists
 * instalments — so the table was the odd one out.
 *
 * It is built ON TOP of `grants` rather than replacing it, which is the whole trick.
 * `grants` stays exactly what it was: one row per award, and the scope every total, KPI,
 * facet-of-money, Attention count and horizon is still computed over. Nothing that sums
 * money moved, so nothing can double-count a grant by its instalment count — the failure
 * this rewrite would otherwise invite, and the one that would be quietest.
 *
 * **The join is LEFT, and that is load-bearing.** An award with no instalments at all is
 * `unscheduled` — money promised with no plan to pay it, which is a finance problem in
 * its own right rather than a quiet zero. Under an INNER join it would have no payment
 * row and would vanish from the one screen whose job is to say so. LEFT gives it exactly
 * one row, and the row reads better than the grant's did: it says "no payment planned"
 * in the very place a date and an amount would otherwise be, and its amount is what is
 * still owed.
 *
 * A cancelled grant's PAID instalments still say `paid` — that money left the building
 * and the history has to reconcile — while its unpaid ones say `cancelled`, because
 * there is nothing left to pay. One that never paid a penny is not on this screen at
 * all; see the WHERE in `grantsQuery`.
 */
export function paymentsQuery(db: Db, g: GrantsQuery, { today, soonCutoff }: FinanceDates) {
  const i = awardInstalments
  // The per-payment ladder, in the same vocabulary (`FinanceStatus`) the grant-level one
  // used, so the pill, the filter, the facet counts and the tab split are unchanged in
  // meaning — only in what they are counted over.
  const status = sql<string>`case
    when ${i.id} is null then 'unscheduled'
    when ${i.paidDate} is not null then 'paid'
    when ${grantsCol('award_status')} = 'cancelled' then 'cancelled'
    when ${i.dueDate} < ${today} then 'overdue'
    when ${i.dueDate} >= ${today} and ${i.dueDate} <= ${soonCutoff} then 'due_soon'
    else 'scheduled'
  end`

  return db
    .select({
      // The row's identity: the instalment, or the award standing in for the payment
      // nobody has scheduled. Both are uuids, cast so the coalesce has one type.
      key: sql<string>`coalesce(${i.id}::text, ${grantsCol('award_id')}::text)`.as('key'),
      instalmentId: sql<string | null>`${i.id}`.as('instalment_id'),
      instalmentNo: sql<number | null>`${i.instalmentNo}`.as('instalment_no'),
      // This payment's money. For the unscheduled row it is what the grant still owes,
      // which is the figure that row exists to put in front of somebody.
      amount: sql<number>`coalesce(${i.amount}::float8, ${grantsCol('outstanding')})`.as('amount'),
      dueDate: sql<string | null>`${i.dueDate}`.as('due_date'),
      paidDate: sql<string | null>`${i.paidDate}`.as('paid_date'),
      status: status.as('status'),

      // ── The grant this payment belongs to ──
      // Repeated on every one of its payments, which is what makes the row readable
      // without a grouped table: the organisation, its reference, and where the payment
      // sits in the schedule are all on the row.
      awardId: sql<string>`${grantsCol('award_id')}`.as('award_id'),
      applicationId: g.applicationId,
      organisationName: g.organisationName,
      externalApplicationId: g.externalApplicationId,
      programmeId: g.programmeId,
      programmeName: g.programmeName,
      roundId: g.roundId,
      roundName: g.roundName,
      tags: g.tags,
      awardStatus: g.awardStatus,
      imported: g.imported,
      bankAccountNumber: g.bankAccountNumber,
      bankAccountName: g.bankAccountName,
      bankSortCode: g.bankSortCode,
      bankStatus: g.bankStatus,
      committed: g.committed,
      paidTotal: g.paidTotal,
      outstanding: g.outstanding,
      instalmentCount: g.instalmentCount,
      paidCount: g.paidCount,
    })
    .from(g)
    .leftJoin(i, sql`${i.awardId} = ${grantsCol('award_id')}`)
    .as('payments')
}

export type PaymentsQuery = ReturnType<typeof paymentsQuery>

/**
 * A column of the `payments` subquery, qualified by hand — `grantsCol`'s twin, for the
 * same reason and with the same trap behind it.
 */
export function paymentsCol(name: string): SQL {
  return sql.raw(`"payments"."${name}"`)
}

/** A page of payments. Exported as a type so the mapper to the screen's row can be typed. */
export function paymentRows(db: Db, p: PaymentsQuery) {
  return db.select().from(p)
}
export type PaymentRow = Awaited<ReturnType<typeof paymentRows>>[number]

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

/**
 * A grant's stored bank verdict, with NULL read as `unchecked`.
 *
 * The column is NULL on grants written before it existed, and the row mapper has always
 * shown those as `unchecked` — an honest "we do not know", not a problem. This is that
 * same coalesce in SQL, so the facet count, the filter and the pill on the row are one
 * definition rather than three.
 */
export function bankVerdict(q: { bankStatus: SQLWrapper }): SQL<string> {
  return sql<string>`coalesce(${q.bankStatus}, 'unchecked')`
}

/**
 * Which tab a row belongs to. Every row is on exactly one, so the two are exhaustive.
 *
 * Deliberately generic over `status`, because the rule is the same sentence at both
 * levels and must stay one: a PAYMENT is settled when it has gone out or been called
 * off, and a GRANT is settled when it has nothing left owing. The list counts payments;
 * the "live commitments" figure in the header counts grants, through this same helper
 * against `grants`. Two spellings of "settled" is exactly how those two disagree.
 */
export function tabWhere(q: { status: SQLWrapper }, tab: 'to_pay' | 'paid'): SQL {
  const settled = sql`${q.status} in ('paid', 'cancelled')`
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
  p: PaymentsQuery,
  tab: 'to_pay' | 'paid',
  f: {
    roundId?: string
    programmeId?: string
    tag?: string
    status?: string
    bank?: string
    from?: string
    to?: string
    q?: string
  },
): SQL | undefined {
  // The payment's OWN date now, not the grant's rolled-up next/last: on a list of
  // payments "between these dates" can finally mean the obvious thing.
  const day = tab === 'paid' ? p.paidDate : p.dueDate
  return and(
    f.roundId ? eq(p.roundId, f.roundId) : undefined,
    f.programmeId ? eq(p.programmeId, f.programmeId) : undefined,
    f.tag ? sql`${p.tags} @> ${JSON.stringify([f.tag])}::jsonb` : undefined,
    f.status ? eq(p.status, f.status) : undefined,
    // Through `bankVerdict`, so the filter matches what the column DRAWS: a row written
    // before the status column existed reads as `unchecked` on screen, and picking
    // "Not checked" has to return it.
    f.bank ? sql`${bankVerdict(p)} = ${f.bank}` : undefined,
    // A row with no date at all is outside any window — it cannot be shown to be inside
    // one, and showing it anyway would make the filter mean "or unknown". That now
    // includes the unscheduled row and a "TBC" instalment, which is the honest answer:
    // neither can be placed in a week.
    f.from ? sql`${day} >= ${f.from}` : undefined,
    f.to ? sql`${day} <= ${f.to}` : undefined,
    // Organisation or the foundation's own reference — the two ways a finance officer
    // holding a bank statement or an invoice identifies a grant.
    searchAny(f.q, p.organisationName, p.externalApplicationId),
  )
}
