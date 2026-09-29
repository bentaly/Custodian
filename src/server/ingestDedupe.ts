// ─── Re-sent submissions ─────────────────────────────────────────────────────
//
// The same submission arrives twice more often than it sounds: a form platform retries
// a delivery it did not see acknowledged, an integration builder's scenario is re-run,
// an applicant double-clicks Submit. Nothing used to notice, so each copy became its own
// application (listed twice, scored twice, voted on twice) or its own report (which
// ticked the NEXT reporting milestone as well as the right one).
//
// Two rules, both deliberately narrow:
//
//   An EXACT re-send (the same foundation, a byte-for-byte equal payload as stored) is
//   absorbed: the later row is closed with a note naming the earlier one and creates
//   nothing. jsonb equality ignores key order, so a platform that reorders a retry still
//   matches. It does NOT point at the earlier row's application or report: the admin
//   app's Delete removes whatever a row points at, and "delete the duplicate" must never
//   delete the original.
//
//   The same APPLICATION REFERENCE with different answers is held for a person
//   (`referenceTaken`, applications only): it is a correction or a clash, and guessing
//   either way is worse than asking. Reports are exempt, because every report on a
//   grant legitimately carries that grant's reference.
//
// "Earlier" is decided by (created_at, id) against the row itself, IN SQL, so two copies
// processed at the same moment agree on which one wins: the earlier is never a
// duplicate, the later always is. Compared column to column rather than against a JS
// Date, which the driver serialises in local time (the BST bug of 2026-09-27).

import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDb } from './db'
import {
  applicationIngests,
  applications,
  reportIngests,
  roundProgrammes,
  rounds,
} from '../../drizzle/schema'

/** The earlier application submission this one is an exact re-send of, if any. */
export async function earlierIdenticalApplication(ingest: {
  id: string
  clientId: string
  rawPayload: Record<string, unknown>
}): Promise<string | null> {
  const t = applicationIngests
  const [row] = await getDb()
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.clientId, ingest.clientId),
        ne(t.id, ingest.id),
        sql`${t.rawPayload} = ${JSON.stringify(ingest.rawPayload)}::jsonb`,
        sql`(${t.createdAt}, ${t.id}) < (select i.created_at, i.id from application_ingests i where i.id = ${ingest.id})`,
      ),
    )
    .orderBy(t.createdAt, t.id)
    .limit(1)
  return row?.id ?? null
}

/** The earlier report submission this one is an exact re-send of, if any. */
export async function earlierIdenticalReport(ingest: {
  id: string
  clientId: string
  rawPayload: Record<string, unknown>
}): Promise<string | null> {
  const t = reportIngests
  const [row] = await getDb()
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.clientId, ingest.clientId),
        ne(t.id, ingest.id),
        sql`${t.rawPayload} = ${JSON.stringify(ingest.rawPayload)}::jsonb`,
        sql`(${t.createdAt}, ${t.id}) < (select i.created_at, i.id from report_ingests i where i.id = ${ingest.id})`,
      ),
    )
    .orderBy(t.createdAt, t.id)
    .limit(1)
  return row?.id ?? null
}

/** The note an absorbed re-send is closed with. */
export function resentNote(earlierId: string): string {
  return `An exact re-send of submission ${earlierId}. Nothing new was created; that submission is the one to act on.`
}

/** Normalised as `findGrantByExternalApplicationId` compares: trimmed, case-blind. */
export function referenceKey(reference: string): string {
  return reference.trim().toLowerCase()
}

/**
 * The foundation's applications already carrying each of these references, keyed on
 * `referenceKey`. One query for any number of references and clients, so the admin
 * queue can diagnose a page of rows at once.
 */
export async function takenReferences(
  pairs: Array<{ clientId: string; reference: string }>,
): Promise<Map<string, Map<string, { applicationId: string; organisationName: string }>>> {
  const out = new Map<string, Map<string, { applicationId: string; organisationName: string }>>()
  if (pairs.length === 0) return out
  const clientIds = [...new Set(pairs.map((p) => p.clientId))]
  const keys = [...new Set(pairs.map((p) => referenceKey(p.reference)))]
  const rows = await getDb()
    .select({
      clientId: rounds.clientId,
      applicationId: applications.id,
      organisationName: applications.organisationName,
      reference: applications.externalApplicationId,
    })
    .from(applications)
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .innerJoin(rounds, eq(roundProgrammes.roundId, rounds.id))
    .where(
      and(
        inArray(rounds.clientId, clientIds),
        inArray(sql`lower(trim(${applications.externalApplicationId}))`, keys),
      ),
    )
  for (const r of rows) {
    if (!r.reference) continue
    const byRef = out.get(r.clientId) ?? new Map()
    byRef.set(referenceKey(r.reference), {
      applicationId: r.applicationId,
      organisationName: r.organisationName,
    })
    out.set(r.clientId, byRef)
  }
  return out
}

/** The application already carrying this reference at this foundation, if any. */
export async function referenceTaken(
  clientId: string,
  reference: string,
): Promise<{ applicationId: string; organisationName: string } | null> {
  const taken = await takenReferences([{ clientId, reference }])
  return taken.get(clientId)?.get(referenceKey(reference)) ?? null
}
