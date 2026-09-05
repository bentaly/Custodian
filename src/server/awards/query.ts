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
import { searchAny } from '../searchTerm'

/**
 * The Awards register, expressed as SQL — the same shape as `server/finance/query.ts`,
 * and for the same reason: the screen used to load every awarded application in the
 * tenant, with its programme, round and full instalment schedule, to render 25 rows.
 *
 *   paid    — one row per award: what has actually gone out.
 *   grants  — application ⋈ award ⋈ paid, one row per grant, with every column the
 *             register filters, sorts or totals by already resolved.
 *
 * Unlike Finance, nothing here is derived: an award's status is a real column. What
 * this buys is the paging, the counts and the portfolio split, all against one snapshot
 * in one `db.batch()`.
 *
 * Two rules carried over verbatim from the version this replaces:
 *
 * - **An awarded application with no award row is skipped**, not guessed at — here that
 *   falls out of the `innerJoin` rather than a `.filter()`.
 * - **`decisionAt` is formatted, not converted.** The column is a naive timestamp
 *   holding UTC (JS wrote it with `toISOString()`), so `to_char` renders exactly those
 *   digits back. `AT TIME ZONE` would silently shift every award date by the session's
 *   offset — which, for a grant awarded late in the evening, moves it a day.
 */

type Db = ReturnType<typeof getDb>

/** One row per award: what has been paid against it. */
function paidRollup(db: Db) {
  const isPaid = sql`${awardInstalments.paidDate} is not null`
  return db
    .select({
      awardId: awardInstalments.awardId,
      instalmentCount: sql<number>`(count(*))::int`.as('instalment_count'),
      paidCount: sql<number>`(count(*) filter (where ${isPaid}))::int`.as('paid_count'),
      paidTotal:
        sql<number>`coalesce(sum(${awardInstalments.amount}) filter (where ${isPaid}), 0)::float8`.as(
          'paid_total',
        ),
    })
    .from(awardInstalments)
    .groupBy(awardInstalments.awardId)
    .as('paid')
}

/**
 * One row per grant. Every column is explicitly aliased — a subquery projecting
 * `awards.id` and `applications.id` publishes two columns called `id`, and the outer
 * reference to either is then ambiguous at runtime with the types perfectly happy.
 *
 * `scope` is the tenancy scope already intersected with the round context, so the
 * facets counted off this set describe the round you are in.
 */
export function grantsQuery(db: Db, scope: string[] | undefined) {
  const paid = paidRollup(db)
  const amount = sql<number>`${awards.amountAwarded}::float8`
  const paidTotal = sql<number>`coalesce(${paid.paidTotal}, 0)`

  return db
    .select({
      awardId: sql<string>`${awards.id}`.as('award_id'),
      applicationId: sql<string>`${applications.id}`.as('application_id'),
      organisationName: sql<string>`${applications.organisationName}`.as('organisation_name'),
      /** The foundation's own reference for the application this grant came from. */
      externalApplicationId: sql<string | null>`${applications.externalApplicationId}`.as(
        'external_application_id',
      ),
      programmeId: sql<string | null>`${roundProgrammes.programmeId}`.as('programme_id'),
      programmeName: sql<string | null>`${programmes.name}`.as('programme_name'),
      programmeColour: sql<string | null>`${programmes.colour}`.as('programme_colour'),
      roundId: sql<string | null>`${roundProgrammes.roundId}`.as('round_id'),
      roundName: sql<string | null>`${rounds.name}`.as('round_name'),
      tags: sql<unknown>`${programmes.tags}`.as('tags'),
      durationYears: sql<number | null>`${roundProgrammes.grantDurationYears}`.as('duration_years'),
      // The region if we resolved one, else whatever the applicant wrote — the same
      // fallback the row's subline has always shown.
      deliveryArea: sql<
        string | null
      >`coalesce(${applications.deliveryRegion}, ${applications.deliveryArea})`.as('delivery_area'),
      status: sql<string>`${awards.status}`.as('status'),
      decisionAt: sql<string>`to_char(${awards.decisionAt}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as(
        'decision_at',
      ),
      /** The day alone, for the date window: a `from` of the 3rd must include the 3rd. */
      decisionDay: sql<string>`to_char(${awards.decisionAt}, 'YYYY-MM-DD')`.as('decision_day'),
      amountAwarded: amount.as('amount_awarded'),
      instalmentCount: sql<number>`coalesce(${paid.instalmentCount}, 0)`.as('instalment_count'),
      paidCount: sql<number>`coalesce(${paid.paidCount}, 0)`.as('paid_count'),
      paidToDate: paidTotal.as('paid_to_date'),
      outstanding: sql<number>`${amount} - ${paidTotal}`.as('outstanding'),
    })
    .from(applications)
    .innerJoin(awards, eq(awards.applicationId, applications.id))
    .leftJoin(paid, eq(paid.awardId, awards.id))
    .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
    .leftJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
    .where(
      and(
        eq(applications.status, 'awarded'),
        // `undefined` scope is superadmin — unrestricted. An empty array never reaches
        // here; the caller short-circuits, because `inArray(x, [])` is a SQL error.
        scope ? inArray(applications.roundProgrammeId, scope) : undefined,
      ),
    )
    .as('grants')
}

export type GrantsQuery = ReturnType<typeof grantsQuery>

/** A page of grants, typed — the mapper to the screen's row hangs off this. */
export function grantRows(db: Db, g: GrantsQuery) {
  return db.select().from(g)
}
export type GrantRow = Awaited<ReturnType<typeof grantRows>>[number]

/**
 * The transient filters: the pills, the date window and the search box. Deliberately
 * NOT the round — that is the context this screen is read in, so it narrows the set the
 * facets are counted over (see `grantsQuery`) rather than being applied here.
 */
export function filterWhere(
  g: GrantsQuery,
  f: {
    programmeId?: string
    tag?: string
    status?: string
    from?: string
    to?: string
    q?: string
  },
): SQL | undefined {
  return and(
    f.programmeId ? eq(g.programmeId, f.programmeId) : undefined,
    f.tag ? sql`${g.tags} @> ${JSON.stringify([f.tag])}::jsonb` : undefined,
    f.status ? eq(g.status, f.status) : undefined,
    f.from ? sql`${g.decisionDay} >= ${f.from}` : undefined,
    f.to ? sql`${g.decisionDay} <= ${f.to}` : undefined,
    // Organisation and the foundation's own reference, which is the row's subtext here
    // and the thing a finance officer has in front of them (`searchAny` escapes it).
    searchAny(f.q, g.organisationName, g.externalApplicationId),
  )
}
