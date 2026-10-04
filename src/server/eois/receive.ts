// ─── An expression of interest arriving ──────────────────────────────────────
//
// The IO around `lib/eois/decode.ts`. Called by `/api/eoi` and its Typeform twin, inside
// the request: there is no queue here and no holding table, because there is nothing slow
// (no model call, no register lookup) and nothing that can hold an EOI. Five queries at
// most, and the row that is written IS the submission.
//
// Two things happen beyond the insert.
//
// **An exact re-send creates nothing.** Form platforms retry, and a person presses
// Submit twice. A payload jsonb-equal to one this foundation has already sent returns
// the row it made the first time. Same rule as `ingestDedupe.ts`, and the same
// comparison: jsonb equality, so key order does not matter.
//
// **An EOI a sourced partner was invited to send is tied to the partnership.** The link
// they were emailed carried `custodian_ref`; when the form hands it back the row gets
// its `partnership_id`, and the partnership moves to `eoi_received` with a line in its
// history, in the SAME batch as the insert. The partnership is shown that it happened,
// and nothing more: the answers live on this row only. The reference is honoured only
// for a partnership of the foundation that authenticated the submission.

import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import {
  eois,
  fieldMappings,
  partnershipEvents,
  partnerships,
  programmes,
} from '../../../drizzle/schema'
import { decodeEoi } from '../../lib/eois/decode'

export async function receiveEoi(params: {
  clientId: string
  payload: Record<string, unknown>
}): Promise<{ id: string; duplicate: boolean }> {
  const { clientId, payload } = params
  const db = getDb()

  const [earlier] = await db
    .select({ id: eois.id })
    .from(eois)
    .where(
      and(eq(eois.clientId, clientId), sql`${eois.rawPayload} = ${JSON.stringify(payload)}::jsonb`),
    )
    .orderBy(eois.createdAt)
    .limit(1)
  if (earlier) return { id: earlier.id, duplicate: true }

  const [mappings, programmeRows] = await Promise.all([
    // The foundation's APPLICATION mappings: an EOI form is usually the application
    // form's shorter sibling and words its questions the same way, and a mapping taught
    // once should not have to be taught again.
    db.query.fieldMappings.findMany({
      where: and(eq(fieldMappings.clientId, clientId), eq(fieldMappings.formType, 'application')),
      columns: { sourceKey: true, canonicalField: true },
    }),
    db
      .select({ id: programmes.id, name: programmes.name, acceptsEois: programmes.acceptsEois })
      .from(programmes)
      .where(and(eq(programmes.clientId, clientId), isNull(programmes.archivedAt))),
  ])

  // The order is taken here, before the payload is written as jsonb and loses it.
  const decoded = decodeEoi(payload, Object.keys(payload), mappings, programmeRows)

  const partnership =
    decoded.inviteRef?.kind === 'partnership'
      ? await db.query.partnerships.findFirst({
          where: and(
            eq(partnerships.id, decoded.inviteRef.id),
            eq(partnerships.clientId, clientId),
          ),
        })
      : undefined

  const id = crypto.randomUUID()
  const insert = db.insert(eois).values({
    id,
    clientId,
    // What the form said wins; what the partnership already knows fills the gaps, since
    // a form sent to an organisation we approached need not ask who they are.
    programmeId: decoded.programmeId ?? partnership?.programmeId ?? null,
    partnershipId: partnership?.id ?? null,
    organisationName:
      decoded.organisationName ?? partnership?.organisationName ?? 'Unnamed organisation',
    reference: decoded.reference,
    contactEmail: decoded.contactEmail ?? partnership?.contactEmail ?? null,
    charityNumber: decoded.charityNumber ?? partnership?.charityNumber ?? null,
    companyNumber: decoded.companyNumber ?? partnership?.companyNumber ?? null,
    amountIndicative: decoded.amountIndicative != null ? String(decoded.amountIndicative) : null,
    responses: decoded.responses,
    rawPayload: payload,
  })

  if (!partnership) {
    await insert
    return { id, duplicate: false }
  }

  // Only a partnership still waiting moves. One already invited, declined or handed
  // over keeps its status: the EOI is recorded against it and somebody will see it, but
  // a late form must not walk a closed relationship back up the pipeline.
  const moves = partnership.status === 'prospective' || partnership.status === 'eoi_issued'
  await db.batch([
    insert,
    db
      .update(partnerships)
      .set({
        ...(moves ? { status: 'eoi_received' as const } : {}),
        eoiReceivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(partnerships.id, partnership.id)),
    db.insert(partnershipEvents).values({
      partnershipId: partnership.id,
      kind: 'eoi_received',
      body: 'Their expression of interest arrived.',
      actorUserId: null,
    }),
  ])
  return { id, duplicate: false }
}
