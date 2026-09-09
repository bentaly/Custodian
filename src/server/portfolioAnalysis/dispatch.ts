// ─── The 3-hourly dispatcher ─────────────────────────────────────────────────
//
// This does NOT analyse anything. It works out which foundations have new data
// since their last summary, and hands one queue message to each — the pattern the
// weekly digest could avoid and this one cannot.
//
// The digest's work per client is a couple of queries and an email, so one
// invocation loops every tenant and still fits inside the Workers budget. Here the
// per-client work is a whole-portfolio read plus 30-60 seconds of model time. One
// client nearly fills an invocation on its own: ten in a loop would pass both the
// 50-subrequest cap and the 30-second post-response ceiling, and a `waitUntil`
// cancelled at that ceiling is ABANDONED rather than rejected, so it would fail
// silently. Hence dispatcher → queue → one fresh invocation per client, each with
// its own budget and 15 minutes.
//
// ── Why a fingerprint and not a timestamp ──
//
// "Has anything happened since the last run" has to catch four different events:
// a new award, a report arriving with an impact figure, a grant being CANCELLED,
// and the foundation rewriting the giving strategy the whole summary is measured
// against. Only the first is a row appearing. A cancellation is an UPDATE, and
// `awards` has no `updated_at` to watch.
//
// So instead of a watermark this takes a cheap census — counts and sums, grouped
// by client, three queries for every tenant at once — and compares it with the
// census stored on the last summary. Anything that moves a figure on the Insights
// screen moves the census. Nothing else spends a model call.

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { getDb } from '../db'
import { awardInstalments, awards, clientProfiles, clients, reports } from '../../../drizzle/schema'
import { insightAnalyses } from '../../../drizzle/schema'

/** FNV-1a. Not a security hash — a cheap, stable, synchronous change detector. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

export interface ClientCensus {
  clientId: string
  clientName: string
  fingerprint: string
}

/**
 * The census, for every client at once.
 *
 * Three grouped queries and one profile read, regardless of how many tenants there
 * are — this is the "cheap" half of the job and has to stay that way.
 */
export async function takeCensus(
  db: ReturnType<typeof getDb>,
  onlyClientId?: string,
): Promise<ClientCensus[]> {
  const clientFilter = onlyClientId ? eq(clients.id, onlyClientId) : undefined

  const [tenants, awardRows, reportRows, paidRows] = await Promise.all([
    db
      .select({
        id: clients.id,
        name: clients.name,
        missionStatement: clientProfiles.missionStatement,
      })
      .from(clients)
      .leftJoin(clientProfiles, eq(clientProfiles.clientId, clients.id))
      .where(clientFilter),
    // Award count, cancelled count and total committed. The sum catches an amount
    // being amended, which changes every figure on the screen and no row count.
    db
      .select({
        clientId: awards.clientId,
        total: sql<number>`count(*)::int`,
        cancelled: sql<number>`count(*) filter (where ${awards.status} = 'cancelled')::int`,
        committed: sql<string>`coalesce(sum(${awards.amountAwarded}), 0)::text`,
      })
      .from(awards)
      .where(onlyClientId ? eq(awards.clientId, onlyClientId) : undefined)
      .groupBy(awards.clientId),
    // Only reports carrying an impact quantity matter here: that is the only field of
    // a report Insights reads. A report arriving without one changes nothing on screen.
    db
      .select({
        clientId: reports.clientId,
        withQuantity: sql<number>`count(*)::int`,
        latest: sql<string>`coalesce(max(${reports.submittedAt})::text, '')`,
      })
      .from(reports)
      .where(
        and(
          isNotNull(reports.impactQuantity),
          onlyClientId ? eq(reports.clientId, onlyClientId) : undefined,
        ),
      )
      .groupBy(reports.clientId),
    // What has actually been PAID. A cancelled grant counts for its payments only, so
    // an instalment marked paid against one moves a figure nothing else here would see.
    db
      .select({
        clientId: awards.clientId,
        paid: sql<string>`coalesce(sum(${awardInstalments.amount}), 0)::text`,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awardInstalments.awardId, awards.id))
      .where(
        and(
          isNotNull(awardInstalments.paidDate),
          onlyClientId ? eq(awards.clientId, onlyClientId) : undefined,
        ),
      )
      .groupBy(awards.clientId),
  ])

  const awardBy = new Map(awardRows.map((r) => [r.clientId, r]))
  const reportBy = new Map(reportRows.map((r) => [r.clientId, r]))
  const paidBy = new Map(paidRows.map((r) => [r.clientId, r]))

  return tenants.map((t) => {
    const a = awardBy.get(t.id)
    const r = reportBy.get(t.id)
    const p = paidBy.get(t.id)
    return {
      clientId: t.id,
      clientName: t.name,
      fingerprint: [
        `a${a?.total ?? 0}`,
        `x${a?.cancelled ?? 0}`,
        `c${a?.committed ?? '0'}`,
        `r${r?.withQuantity ?? 0}`,
        `t${r?.latest ?? ''}`,
        `p${p?.paid ?? '0'}`,
        // The strategy is the yardstick the whole paragraph is written against, so
        // rewriting it invalidates the summary even when not one grant has changed.
        `m${hash(t.missionStatement ?? '')}`,
      ].join('|'),
    }
  })
}

export interface DispatchDecision {
  clientId: string
  clientName: string
  fingerprint: string
  /** Null when this client has never had a summary generated. */
  previousFingerprint: string | null
  stale: boolean
}

/**
 * Which clients need a fresh summary.
 *
 * `force` re-runs regardless, which is what makes the prompt tunable: without it a
 * second dry run against unchanged data is a no-op and there is no way to see the
 * effect of an edit.
 */
export async function planDispatch(
  db: ReturnType<typeof getDb>,
  opts: { onlyClientId?: string; force?: boolean } = {},
): Promise<DispatchDecision[]> {
  const census = await takeCensus(db, opts.onlyClientId)
  if (census.length === 0) return []

  // The newest summary per client. `distinct on` rather than a window function or a
  // query per tenant: one round trip whatever the number of clients.
  const latest = await db
    .selectDistinctOn([insightAnalyses.clientId], {
      clientId: insightAnalyses.clientId,
      fingerprint: insightAnalyses.inputFingerprint,
    })
    .from(insightAnalyses)
    .where(opts.onlyClientId ? eq(insightAnalyses.clientId, opts.onlyClientId) : undefined)
    .orderBy(insightAnalyses.clientId, sql`${insightAnalyses.generatedAt} desc`)

  const previousBy = new Map(latest.map((r) => [r.clientId, r.fingerprint]))

  return census.map((c) => {
    const previous = previousBy.get(c.clientId) ?? null
    return {
      ...c,
      previousFingerprint: previous,
      stale: opts.force === true || previous !== c.fingerprint,
    }
  })
}
