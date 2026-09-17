// ─── The new-awards run ──────────────────────────────────────────────────────
//
// Called by `/api/cron/award-notifications` on the daytime trigger, right after the
// portfolio-analysis dispatcher. Same two facts shape it as the digests: the caller has
// no session, and it may run twice.
//
// No session → the query filters `awards.client_id` through the recipient's own row and
// there is no cross-tenant path (see `pendingAwardNotifications`).
// May run twice → a receipt per (award, recipient) is written after the send, so a
// re-run finishes whoever was missed and tells nobody anything twice.
//
// Unlike the digests this run does NOT need to batch by week or dedupe by date: the
// pending query already returns only what is unannounced, so an empty result is the
// normal state and costs one query.

import { getDb } from '../db'
import { awardNotificationSends } from '../../../drizzle/schema'
import { sendAwardNotificationEmail } from '../../lib/email'
import { deploymentName, isProductionDeployment } from '../deployEnvironment'
import { wantsAwardNotifications } from '../../lib/awardNotifications/optIn'
import { renderAwardNotification } from '../../lib/awardNotifications/render'
import {
  awardNotificationHasContent,
  type AwardNotificationItem,
  type AwardNotificationModel,
} from '../../lib/awardNotifications/types'
import { pendingAwardNotifications } from './query'
import { unsubscribeUrl } from '../digestUnsubscribe'

export type AwardNotificationOutcome =
  | { userId: string; email: string; result: 'sent'; awardCount: number }
  | { userId: string; email: string; result: 'dry_run'; awardCount: number }
  | { userId: string; email: string; result: 'failed'; awardCount: number; error: string }

export interface AwardNotificationRunSummary {
  /** What the run ACTUALLY did, which is not always what was asked for. */
  dryRun: boolean
  /** Pairs the query found before the opt-in rule was applied. */
  pending: number
  sent: number
  failed: number
  outcomes: AwardNotificationOutcome[]
}

function appOrigin(): string {
  return (process.env['BETTER_AUTH_URL'] ?? 'http://localhost:5174').replace(/\/+$/, '')
}

/** Forced on outside production. Same rule and reasoning as the digests. */
function resolveDryRun(requested: boolean | undefined): boolean {
  if (requested) return true
  if (isProductionDeployment()) return false
  console.warn(
    `[award-notifications] ${deploymentName()} is not production - forcing a dry run; nothing sent`,
  )
  return true
}

/**
 * Tell every opted-in admin about the grants set up since we last told them.
 *
 * One email per PERSON, not per award: a board meeting that produced twelve grants is
 * one message with twelve lines. That is the entire reason this is a cron job and not a
 * send at the end of `createAwards`, where the natural unit is the batch somebody just
 * typed and the failure mode is twelve emails in ninety seconds.
 */
export async function runAwardNotifications(
  opts: { dryRun?: boolean; onlyClientId?: string; windowDays?: number } = {},
): Promise<AwardNotificationRunSummary> {
  const db = getDb()
  const dryRun = resolveDryRun(opts.dryRun)
  const origin = appOrigin()
  const outcomes: AwardNotificationOutcome[] = []

  const pending = await pendingAwardNotifications(db, opts)
  // The opt-in rule, applied in ONE place. The query deliberately does not filter on
  // role, so this predicate is the only statement of who may receive the email.
  const wanted = pending.filter(wantsAwardNotifications)
  if (wanted.length === 0) {
    return { dryRun, pending: pending.length, sent: 0, failed: 0, outcomes }
  }

  // One email per recipient, carrying every award they have not been told about.
  const byUser = new Map<string, { row: (typeof wanted)[number]; items: AwardNotificationItem[] }>()
  for (const row of wanted) {
    const entry = byUser.get(row.userId)
    if (entry) entry.items.push(row.item)
    else byUser.set(row.userId, { row, items: [row.item] })
  }

  for (const [userId, { row, items }] of byUser) {
    const model: AwardNotificationModel = {
      clientName: row.clientName,
      recipientName: row.recipientName,
      items,
      awardsUrl: `${origin}/awards`,
      unsubscribeUrl: await unsubscribeUrl(origin, userId, 'awards'),
    }

    // Unreachable in practice - the query only returns pairs that exist - but stated
    // rather than assumed, like the digests' equivalent.
    if (!awardNotificationHasContent(model)) continue

    if (dryRun) {
      outcomes.push({ userId, email: row.email, result: 'dry_run', awardCount: items.length })
      continue
    }

    const rendered = renderAwardNotification(model)
    const result = await sendAwardNotificationEmail({ to: row.email, ...rendered })

    if (!result.ok) {
      // Logged, not thrown: one rejected address must not cost the other recipients
      // theirs, and with no receipt written this person is retried on the next tick.
      console.error(`[award-notifications] send to ${row.email} failed: ${result.error}`)
      outcomes.push({
        userId,
        email: row.email,
        result: 'failed',
        awardCount: items.length,
        error: result.error ?? 'unknown',
      })
      continue
    }

    // The receipts: one row per award this person has now been told about, written in
    // ONE insert. They are a single fact - "this email went out" - so a partial write
    // would re-announce the remainder next tick.
    await db
      .insert(awardNotificationSends)
      .values(items.map((i) => ({ awardId: i.awardId, userId })))
      .onConflictDoNothing()

    outcomes.push({ userId, email: row.email, result: 'sent', awardCount: items.length })
  }

  return {
    dryRun,
    pending: pending.length,
    sent: outcomes.filter((o) => o.result === 'sent').length,
    failed: outcomes.filter((o) => o.result === 'failed').length,
    outcomes,
  }
}
