// ─── The Monday reports run ──────────────────────────────────────────────────
//
// Called by `/api/cron/reports-digest`, which the same Monday Cron Trigger drives right
// after the payments one (see `worker-entry.js`). The control flow is the payments
// run's, for the same two reasons: the caller has no session, and it may run twice for
// the same week.
//
// No session → every read is scoped by an explicit clientId (see `reportDigestWindow`).
// May run twice → a send is recorded in `report_digest_sends` and a user who already has
// a receipt for the week is skipped. The receipt is written AFTER the send, never
// claimed before it: a duplicate email is an annoyance, a missing one means a report
// goes unchased, which is the thing this exists to prevent.

import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { deploymentName, isProductionDeployment } from '../deployEnvironment'
import { clients, reportDigestSends, users } from '../../../drizzle/schema'
import { sendReportsDigestEmail } from '../../lib/email'
import { startOfWeekIso, todayIso } from '../../lib/schedule'
import { reportDigestHasContent, type ReportDigestModel } from '../../lib/reportsDigest/types'
import { wantsReportsDigest } from '../../lib/reportsDigest/optIn'
import { renderReportDigest } from '../../lib/reportsDigest/render'
import { reportDigestWindow } from './query'
import { unsubscribeUrl } from '../digestUnsubscribe'

/** Why a given user did or did not get an email. One line per recipient, for the log. */
export type ReportDigestOutcome =
  | { userId: string; email: string; result: 'sent'; itemCount: number }
  | { userId: string; email: string; result: 'dry_run'; itemCount: number }
  | { userId: string; email: string; result: 'nothing_due' }
  | { userId: string; email: string; result: 'already_sent' }
  | { userId: string; email: string; result: 'failed'; error: string }

/**
 * Outside production, a run is forced to a DRY RUN.
 *
 * `[env.staging.triggers] crons = []` already stops the Cron Trigger firing on staging,
 * and that is the first line of defence. This is the second, because the first covers
 * only the CRON: the endpoint is a curl away, `.env`'s `DATABASE_URL` points at staging,
 * and `FROM_EMAIL` is a verified `custodian.fund` address in `.env` too — so a laptop
 * can send real email to real people. Staging's user rows come from the same Neon
 * lineage as prod, so a good number of those addresses are live mailboxes belonging to
 * actual foundations.
 *
 * Forcing `dryRun` rather than refusing outright keeps staging useful: the run still
 * renders every email and returns it, which is the whole reason to curl it there.
 * Nothing is sent and no receipt is written.
 *
 * The EFFECTIVE value is reported back on the summary, so a caller who asked for a real
 * run on staging is told it did not happen rather than reading `sent: 0` as "no work".
 */
function resolveDryRun(requested: boolean | undefined, label: string): boolean {
  if (requested) return true
  if (isProductionDeployment()) return false
  console.warn(`[${label}] ${deploymentName()} is not production - forcing a dry run; nothing sent`)
  return true
}

export interface ReportDigestRunSummary {
  /** What the run ACTUALLY did, which is not always what was asked for. */
  dryRun: boolean
  weekOf: string
  sent: number
  skipped: number
  failed: number
  outcomes: ReportDigestOutcome[]
}

/**
 * The app's own origin, for the links in the email. `BETTER_AUTH_URL` is reused rather
 * than adding a second URL secret — it is already required in both Workers and already
 * the value that breaks loudly when wrong, so it cannot quietly point staging's email
 * at production.
 */
function appOrigin(): string {
  return (process.env['BETTER_AUTH_URL'] ?? 'http://localhost:5174').replace(/\/+$/, '')
}

/**
 * Run the reports digest for every foundation.
 *
 * `dryRun` renders and reports without sending or recording anything — the mode to
 * exercise this in for the first few weeks, so we can read what Monday's email would
 * have said before anyone receives one.
 */
export async function runReportsDigest(
  opts: { dryRun?: boolean; weekOf?: string; onlyClientId?: string } = {},
): Promise<ReportDigestRunSummary> {
  const db = getDb()
  const weekOf = opts.weekOf ?? startOfWeekIso(todayIso())
  const origin = appOrigin()
  // Forced on outside production. See `resolveDryRun`.
  const dryRun = resolveDryRun(opts.dryRun, 'reports-digest')
  const outcomes: ReportDigestOutcome[] = []

  // Every tenant-attached user. Superadmins have no client_id and are excluded by the
  // join; the role filter that narrows this to admins is `wantsReportsDigest` below,
  // applied in one place so the rule cannot drift between here and the Profile screen.
  const candidates = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      weeklyReportsDigest: users.weeklyReportsDigest,
      clientId: users.clientId,
      clientName: clients.name,
    })
    .from(users)
    .innerJoin(clients, eq(clients.id, users.clientId))
    .where(
      and(
        isNotNull(users.clientId),
        eq(users.banned, false),
        // A removed member's address is already tombstoned; this says so out loud.
        isNull(users.archivedAt),
        opts.onlyClientId ? eq(users.clientId, opts.onlyClientId) : undefined,
      ),
    )

  const recipients = candidates.filter(wantsReportsDigest)
  if (recipients.length === 0) {
    return { weekOf, dryRun, sent: 0, skipped: 0, failed: 0, outcomes }
  }

  // Which of them already have this week's email. One query rather than one per user:
  // the run is on a CPU budget and per-user round trips are the easiest way to spend it.
  const existing = await db
    .select({ userId: reportDigestSends.userId })
    .from(reportDigestSends)
    .where(
      and(
        eq(reportDigestSends.weekOf, weekOf),
        inArray(
          reportDigestSends.userId,
          recipients.map((r) => r.id),
        ),
      ),
    )
  const alreadySent = new Set(existing.map((r) => r.userId))

  // One window query per CLIENT, not per user: a foundation with two admins asks the
  // same question twice otherwise.
  const byClient = new Map<string, typeof recipients>()
  for (const r of recipients) {
    const list = byClient.get(r.clientId!) ?? []
    list.push(r)
    byClient.set(r.clientId!, list)
  }

  for (const [clientId, group] of byClient) {
    const window = await reportDigestWindow(db, clientId)
    const itemCount = window.overdue.length + window.dueThisWeek.length

    for (const user of group) {
      if (alreadySent.has(user.id)) {
        outcomes.push({ userId: user.id, email: user.email, result: 'already_sent' })
        continue
      }

      const model: ReportDigestModel = {
        clientName: user.clientName,
        recipientName: user.name,
        weekOf,
        overdue: window.overdue,
        dueThisWeek: window.dueThisWeek,
        reportsUrl: `${origin}/reports`,
        unsubscribeUrl: await unsubscribeUrl(origin, user.id, 'reports'),
      }

      // Nothing expected is not an email. See `reportDigestHasContent`.
      if (!reportDigestHasContent(model)) {
        outcomes.push({ userId: user.id, email: user.email, result: 'nothing_due' })
        continue
      }

      const rendered = renderReportDigest(model)

      if (dryRun) {
        outcomes.push({ userId: user.id, email: user.email, result: 'dry_run', itemCount })
        continue
      }

      const result = await sendReportsDigestEmail({
        to: user.email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })

      if (!result.ok) {
        // Logged, not thrown: one rejected address must not cost the other recipients
        // their email, and with no receipt written this user is retried by a re-run.
        console.error(`[reports-digest] send to ${user.email} failed: ${result.error}`)
        outcomes.push({
          userId: user.id,
          email: user.email,
          result: 'failed',
          error: result.error ?? 'unknown',
        })
        continue
      }

      // The receipt. `onConflictDoNothing` because a concurrent run may have got there
      // between the SELECT above and now — the unique index is the real guard, that
      // query is only an optimisation.
      await db
        .insert(reportDigestSends)
        .values({ userId: user.id, clientId, weekOf, itemCount })
        .onConflictDoNothing()

      outcomes.push({ userId: user.id, email: user.email, result: 'sent', itemCount })
    }
  }

  return {
    weekOf,
    dryRun,
    sent: outcomes.filter((o) => o.result === 'sent').length,
    skipped: outcomes.filter((o) => o.result === 'already_sent' || o.result === 'nothing_due')
      .length,
    failed: outcomes.filter((o) => o.result === 'failed').length,
    outcomes,
  }
}
