// ─── The Monday run ──────────────────────────────────────────────────────────
//
// Called by `/api/cron/finance-digest`, which is called by a Cron Trigger (once wired)
// or by hand. Everything about the control flow here is shaped by two facts about that
// caller: it has no session, and it may run twice for the same week.
//
// No session → every read is scoped by an explicit clientId (see `digestWindow`).
// May run twice → a send is recorded in `finance_digest_sends`, and a user who already
// has a receipt for the week is skipped. See the table's comment for why the receipt is
// written AFTER the send rather than claimed before it.

import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '../db'
import { clients, financeDigestSends, users } from '../../../drizzle/schema'
import { sendFinanceDigestEmail } from '../../lib/email'
import { startOfWeekIso, todayIso } from '../../lib/schedule'
import { digestHasContent, digestTotal, type DigestModel } from '../../lib/financeDigest/types'
import { wantsDigest } from '../../lib/financeDigest/optIn'
import { renderDigest } from '../../lib/financeDigest/render'
import { digestWindow } from './query'
import { unsubscribeUrl } from './unsubscribe'

/** Why a given user did or did not get an email. One line per recipient, for the log. */
export type DigestOutcome =
  | { userId: string; email: string; result: 'sent'; itemCount: number; total: number }
  | { userId: string; email: string; result: 'dry_run'; itemCount: number; total: number }
  | { userId: string; email: string; result: 'nothing_due' }
  | { userId: string; email: string; result: 'already_sent' }
  | { userId: string; email: string; result: 'failed'; error: string }

export interface DigestRunSummary {
  weekOf: string
  sent: number
  skipped: number
  failed: number
  outcomes: DigestOutcome[]
}

/**
 * The app's own origin, for the links in the email.
 *
 * `BETTER_AUTH_URL` is reused rather than adding a second URL secret: it is already
 * required in both Workers, already environment-correct, and already the value that
 * breaks loudly when wrong (OAuth stops working), so it cannot quietly drift into
 * pointing staging's email at production.
 */
function appOrigin(): string {
  return (process.env['BETTER_AUTH_URL'] ?? 'http://localhost:5174').replace(/\/+$/, '')
}

/**
 * Run the digest for every foundation.
 *
 * `dryRun` renders and reports without sending or recording anything — the mode the
 * endpoint is meant to be exercised in for the first few weeks, so we can read what
 * Monday's email would have said before anyone receives one.
 */
export async function runFinanceDigest(
  opts: { dryRun?: boolean; weekOf?: string; onlyClientId?: string } = {},
): Promise<DigestRunSummary> {
  const db = getDb()
  const weekOf = opts.weekOf ?? startOfWeekIso(todayIso())
  const origin = appOrigin()
  const outcomes: DigestOutcome[] = []

  // Every tenant-attached user, with the client name the email is headed with.
  // Superadmins have no client_id and are excluded by the join — there is no foundation
  // whose payments a digest to them would be about.
  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      weeklyFinanceDigest: users.weeklyFinanceDigest,
      clientId: users.clientId,
      clientName: clients.name,
    })
    .from(users)
    .innerJoin(clients, eq(clients.id, users.clientId))
    .where(
      and(
        isNotNull(users.clientId),
        eq(users.banned, false),
        opts.onlyClientId ? eq(users.clientId, opts.onlyClientId) : undefined,
      ),
    )

  const recipients = candidates.filter(wantsDigest)
  if (recipients.length === 0) {
    return { weekOf, sent: 0, skipped: 0, failed: 0, outcomes }
  }

  // Which of them already have this week's email. One query rather than one per user:
  // the run is on a CPU budget (10ms on the Workers Free plan) and per-user round trips
  // are the easiest way to spend it.
  const existing = await db
    .select({ userId: financeDigestSends.userId })
    .from(financeDigestSends)
    .where(
      and(
        eq(financeDigestSends.weekOf, weekOf),
        inArray(
          financeDigestSends.userId,
          recipients.map((r) => r.id),
        ),
      ),
    )
  const alreadySent = new Set(existing.map((r) => r.userId))

  // One window query per CLIENT, not per user: a foundation with four finance officers
  // asks the same question four times otherwise.
  const byClient = new Map<string, typeof recipients>()
  for (const r of recipients) {
    const list = byClient.get(r.clientId!) ?? []
    list.push(r)
    byClient.set(r.clientId!, list)
  }

  for (const [clientId, group] of byClient) {
    const window = await digestWindow(db, clientId)
    const itemCount = window.overdue.length + window.dueThisWeek.length
    const total = digestTotal(window.overdue) + digestTotal(window.dueThisWeek)

    for (const user of group) {
      if (alreadySent.has(user.id)) {
        outcomes.push({ userId: user.id, email: user.email, result: 'already_sent' })
        continue
      }

      const model: DigestModel = {
        clientName: user.clientName,
        recipientName: user.name,
        weekOf,
        overdue: window.overdue,
        dueThisWeek: window.dueThisWeek,
        financeUrl: `${origin}/finance`,
        unsubscribeUrl: await unsubscribeUrl(origin, user.id),
      }

      // Nothing due is not an email. See `digestHasContent` — an "all clear" every week
      // is what trains people to filter this away, and a filtered digest is worse than
      // none because the week it matters is the week it goes unread.
      if (!digestHasContent(model)) {
        outcomes.push({ userId: user.id, email: user.email, result: 'nothing_due' })
        continue
      }

      const rendered = renderDigest(model)

      if (opts.dryRun) {
        outcomes.push({ userId: user.id, email: user.email, result: 'dry_run', itemCount, total })
        continue
      }

      const result = await sendFinanceDigestEmail({
        to: user.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })

      if (!result.ok) {
        // Logged, not thrown: one rejected address must not cost the other recipients
        // their email, and with no receipt written this user is retried by a re-run.
        console.error(`[finance-digest] send to ${user.email} failed: ${result.error}`)
        outcomes.push({
          userId: user.id,
          email: user.email,
          result: 'failed',
          error: result.error ?? 'unknown',
        })
        continue
      }

      // The receipt. `onConflictDoNothing` because a concurrent run (two Cron Triggers
      // an hour apart, one manual curl) may have got there between the SELECT above and
      // now — the unique index is the real guard, that query is only an optimisation.
      await db
        .insert(financeDigestSends)
        .values({
          userId: user.id,
          clientId,
          weekOf,
          itemCount,
          totalAmount: String(total),
        })
        .onConflictDoNothing()

      outcomes.push({ userId: user.id, email: user.email, result: 'sent', itemCount, total })
    }
  }

  return {
    weekOf,
    sent: outcomes.filter((o) => o.result === 'sent').length,
    skipped: outcomes.filter((o) => o.result === 'already_sent' || o.result === 'nothing_due')
      .length,
    failed: outcomes.filter((o) => o.result === 'failed').length,
    outcomes,
  }
}
