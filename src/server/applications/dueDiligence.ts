// ─── Due diligence, as its own step ──────────────────────────────────────────
//
// The same shape as `deprivation.ts`, and it exists for the same reason: the
// onboarding data import writes a whole back catalogue in one request, and screening
// a hundred organisations against the Charity Commission, OSCR, Companies House and
// 360Giving inside it is far past both the 30-second post-response ceiling and the
// 50-subrequest budget an invocation gets on the Free plan. So the import queues one
// message per imported application and this runs it.
//
// Why an import screens at all, when it deliberately does not score: due diligence is
// a CURRENT-state check. Nothing about it goes stale by being run late — a charity
// removed from the register was removed whether or not the grant was made in 2019 —
// and a foundation onboarding a portfolio it is still paying instalments against is
// exactly the one that wants to know. The Custodian score is the opposite: it judges
// an application against goals, and a 2019 application against 2026 goals is a
// confident, meaningless number, so it stays blank forever.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applications } from '../../../drizzle/schema'
import { runDueDiligence } from '../dueDiligence/run'
import type { DueDiligenceStatus } from '../../lib/dueDiligence'

export type ScreenApplicationResult =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_screened'; status: DueDiligenceStatus }
  | { ok: true; status: DueDiligenceStatus }

/**
 * Screen one application against the registers and store the verdict.
 *
 * Only acts on a row still at `pending` unless `force` is set — the guard that makes
 * this safe to call twice, exactly as in `scoreApplication` and
 * `resolveApplicationDeprivation`. An application with no number to screen comes back
 * `no_registration`, which is a verdict rather than a gap, so it leaves `pending` and
 * is not retried; `rerunDueDiligence` (which can also SUPPLY the missing numbers) is
 * the way out of that, and is deliberately allowed after an award.
 *
 * Never throws for a screening failure — `runDueDiligence` reports an unreachable
 * register as a check result, so a queue is never sent into retry over it.
 */
export async function screenApplication(
  applicationId: string,
  opts: { force?: boolean } = {},
): Promise<ScreenApplicationResult> {
  const db = getDb()
  const application = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    columns: {
      id: true,
      charityNumber: true,
      companyNumber: true,
      organisationName: true,
      amountRequested: true,
      dueDiligenceStatus: true,
    },
  })
  if (!application) return { ok: false, reason: 'not_found' }
  if (application.dueDiligenceStatus !== 'pending' && !opts.force) {
    return { ok: false, reason: 'already_screened', status: application.dueDiligenceStatus }
  }

  const result = await runDueDiligence({
    charityNumber: application.charityNumber,
    companyNumber: application.companyNumber,
    organisationName: application.organisationName,
    amountRequested: Number(application.amountRequested),
  })

  await db
    .update(applications)
    .set({
      dueDiligenceStatus: result.status,
      dueDiligenceChecks: result.checks,
      dueDiligenceCheckedAt: new Date(result.checkedAt),
      organisationProfile: result.profile,
    })
    .where(eq(applications.id, applicationId))

  // No `audit_log` row. `rerunDueDiligence` writes one only when a human SUPPLIES a
  // registration number, because that is a judgement about who is being funded; a
  // screening run is not, and an import that wrote 127 audit rows is one of the three
  // things an import must never do.
  return { ok: true, status: result.status }
}
