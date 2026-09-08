// ─── Deprivation resolution, as its own step ─────────────────────────────────
//
// A real submission resolves its delivery area inline, inside
// `createApplicationFromCanonical` — one application, one geocode, and the caller is
// already waiting. The onboarding data import cannot do that: it writes a whole back
// catalogue in one request, and resolving 127 delivery areas means 127 Google
// geocodes plus their postcodes.io and `deprivation_areas` follow-ups, which is far
// past both the 30-second `waitUntil` ceiling and the 50-subrequest budget an
// invocation gets on the Free plan.
//
// So the import queues one message per imported application and this is what those
// messages run. Same shape as `score.ts`, and for the same reason: work that is too
// big for the request that asked for it, made safe to call more than once.
//
// It matters that this exists at all. `dataImport` leaves every imported row's
// deprivation at `pending` on the stated grounds that it "re-derives itself from the
// delivery area we just imported" — but nothing ever re-derived it, so a foundation
// that imported its portfolio got a permanently empty deprivation picture on
// Insights, which is most of what Insights is for.

import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { applications } from '../../../drizzle/schema'
import { resolveDeprivation } from '../deprivation/run'
import { deliveryGeoFromResult } from '../../lib/deprivation/types'
import type { DeprivationResult } from '../../lib/deprivation/types'

export type ResolveApplicationDeprivationResult =
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'already_resolved'; status: string }
  | { ok: true; status: DeprivationResult['status'] }

/**
 * Resolve and store one application's deprivation context.
 *
 * Only acts on a row still at `pending` unless `force` is set — the same guard
 * `scoreApplication` uses, so a queue redelivering a message that already landed
 * does nothing rather than spending another geocode.
 *
 * `pending` is the right thing to re-run on, and deliberately not `unresolvable`:
 * `pending` means we could not ask (no API key, Google refused), while
 * `unresolvable` is a verdict on the applicant's own text that a grants officer
 * reads and acts on. Overwriting the second on a whim would erase an answer.
 *
 * Never throws for a resolution failure — `resolveDeprivation` reports one as a
 * status, so a queue is never sent into retry over something retrying will not fix.
 */
export async function resolveApplicationDeprivation(
  applicationId: string,
  opts: { force?: boolean } = {},
): Promise<ResolveApplicationDeprivationResult> {
  const db = getDb()
  const application = await db.query.applications.findFirst({
    where: eq(applications.id, applicationId),
    columns: { id: true, deliveryArea: true, deprivationStatus: true },
  })
  if (!application) return { ok: false, reason: 'not_found' }
  if (application.deprivationStatus !== 'pending' && !opts.force) {
    return { ok: false, reason: 'already_resolved', status: application.deprivationStatus }
  }

  const deprivation = await resolveDeprivation(application.deliveryArea)
  // `pending` back from the resolver means it could not ask at all. Storing the
  // result and a resolved-at timestamp for that would dress "not run yet" up as an
  // answer, and would take the row out of the set `--pending` recovers.
  const attempted = deprivation.status !== 'pending'
  const geo = deliveryGeoFromResult(deprivation)

  await db
    .update(applications)
    .set({
      deprivationStatus: deprivation.status,
      deprivationContext: attempted ? deprivation : null,
      deprivationResolvedAt: attempted ? new Date() : null,
      deliveryNation: geo.nation,
      deliveryRegion: geo.region,
      deliveryLadCode: geo.ladCode,
      deliveryLadName: geo.ladName,
    })
    .where(eq(applications.id, applicationId))

  return { ok: true, status: deprivation.status }
}
