// ─── Tying a submission back to the invitation that prompted it ──────────────
//
// An invitation emails a link to the foundation's own form with `custodian_ref` on it
// (`lib/sourcing/inviteRef.ts`). When the form hands that field back, this is what makes
// the connection: the partnership (or the EOI, and through it the partnership) is pointed
// at the application that arrived, and the partnership moves to `applied`.
//
// **Best-effort, and never allowed to fail a submission.** It runs after the application
// is committed, and it catches everything: an application that exists but is not linked
// is a small thing an admin fixes with "Link an application" on the partnership, whereas
// an exception here would send a queue message into retry over an application that is
// already safely in the database.
//
// **The reference is honoured only inside the tenant the submission authenticated as.**
// Every update below carries `client_id`; a reference naming another foundation's row
// matches nothing and is ignored.

import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { eois, partnershipEvents, partnerships } from '../../../drizzle/schema'
import { findInviteRef } from '../../lib/sourcing/inviteRef'
import { reportFault } from '../faults'

/** Point one partnership at its application. Does nothing if it already points at one. */
async function handOver(clientId: string, partnershipId: string, applicationId: string) {
  const db = getDb()
  const partnership = await db.query.partnerships.findFirst({
    where: and(eq(partnerships.id, partnershipId), eq(partnerships.clientId, clientId)),
    columns: { id: true, applicationId: true },
  })
  // First one wins. A second application carrying the same reference (a re-submitted
  // form) must not quietly re-point the partnership away from the first.
  if (!partnership || partnership.applicationId) return false
  await db.batch([
    db
      .update(partnerships)
      .set({ applicationId, status: 'applied', updatedAt: new Date() })
      .where(and(eq(partnerships.id, partnership.id), isNull(partnerships.applicationId))),
    db.insert(partnershipEvents).values({
      partnershipId: partnership.id,
      kind: 'applied',
      body: 'Their application arrived.',
      actorUserId: null,
    }),
  ])
  return true
}

/**
 * Link a newly created application to whatever invited it, if its submission says.
 * Returns what was linked, for the caller's log; null when there was nothing to link.
 */
export async function linkInvitedApplication(
  clientId: string,
  payload: Record<string, unknown>,
  applicationId: string,
): Promise<{ partnershipId: string | null; eoiId: string | null } | null> {
  const ref = findInviteRef(payload)
  if (!ref) return null
  try {
    if (ref.kind === 'partnership') {
      const linked = await handOver(clientId, ref.id, applicationId)
      return linked ? { partnershipId: ref.id, eoiId: null } : null
    }

    const db = getDb()
    const eoi = await db.query.eois.findFirst({
      where: and(eq(eois.id, ref.id), eq(eois.clientId, clientId)),
      columns: { id: true, applicationId: true, partnershipId: true },
    })
    if (!eoi || eoi.applicationId) return null
    await db
      .update(eois)
      .set({ applicationId, status: 'applied', updatedAt: new Date() })
      .where(and(eq(eois.id, eoi.id), isNull(eois.applicationId)))
    // An EOI that a sourced partner sent carries the partnership along with it.
    if (eoi.partnershipId) await handOver(clientId, eoi.partnershipId, applicationId)
    return { partnershipId: eoi.partnershipId, eoiId: eoi.id }
  } catch (err) {
    reportFault('invite-link', err, { clientId, applicationId, ref })
    return null
  }
}
