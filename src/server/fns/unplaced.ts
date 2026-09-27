// Submissions that arrived during a round but could not be put in one of its
// programmes: the form named no programme, or one this foundation does not run. They
// are listed in a banner on Applications for that round, where an admin places them.
//
// Deliberately narrow. Only a held submission whose ONE problem is the programme is
// offered here; anything else wrong with it (no organisation name, no reference, an
// answer that fails validation) is still ours to sort out in the admin app, because
// placing it would only fail on the next problem. And the round is inferred from when
// it arrived, so one that came in while no round was open stays in the admin app too.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, gte, isNull, lte } from 'drizzle-orm'
import { getDb } from '../db'
import { applicationIngests } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { conflict, notFoundError } from '../../lib/errors'
import { diagnoseIngests } from '../fieldMapping/diagnose'
import {
  buildCanonicalInput,
  buildSubmittedFields,
  computeResponses,
  resolvedFromMapping,
} from '../fieldMapping/assemble'
import { CreateApplicationSchema } from '../../lib/validators/application'
import { toStringValue } from '../../lib/fieldMapping'
import { SUGGEST_THRESHOLD, similarity } from '../../lib/dataImport/match'
import {
  createApplicationFromCanonical,
  fetchRoundProgrammeForApplication,
} from '../applications/create'
import { scoreApplication } from '../applications/score'
import { enqueue } from '../pipelineQueue'
import { recordAudit } from '../audit'

const PROGRAMME_CODES = new Set(['programme_unmapped', 'programme_unknown', 'programme_not_open'])

/** `sourceKey -> canonical` (as stored) turned round to `canonical -> sourceKey`. */
function mappingOf(resolved: Record<string, string> | null): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [sourceKey, canonical] of Object.entries(resolved ?? {})) m[canonical] = sourceKey
  return m
}

export const listUnplaced = createServerFn({ method: 'GET' })
  .validator(z.object({ roundId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const round = await getDb().query.rounds.findFirst({
      where: (r, { eq }) => eq(r.id, data.roundId),
      with: { roundProgrammes: { with: { programme: { columns: { id: true, name: true } } } } },
    })
    if (!round) throw notFoundError()
    assertClientAccess(user, round.clientId)
    if (!round.openedAt) return { rows: [], programmes: [] }

    const held = await getDb()
      .select()
      .from(applicationIngests)
      .where(
        and(
          eq(applicationIngests.clientId, round.clientId),
          eq(applicationIngests.status, 'needs_review'),
          isNull(applicationIngests.applicationId),
          isNull(applicationIngests.roundProgrammeId),
          gte(applicationIngests.createdAt, round.openedAt),
          ...(round.closedAt ? [lte(applicationIngests.createdAt, round.closedAt)] : []),
        ),
      )
      .limit(50)
    if (held.length === 0) return { rows: [], programmes: [] }

    const blockers = await diagnoseIngests(held)
    const programmes = round.roundProgrammes
      .map((rp) => ({ roundProgrammeId: rp.id, name: rp.programme.name.trim() }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const rows = held
      .filter((row) => {
        const found = (blockers.get(row.id) ?? []).filter((b) => b.severity === 'blocking')
        return found.length > 0 && found.every((b) => PROGRAMME_CODES.has(b.code))
      })
      .map((row) => {
        const m = mappingOf(row.resolved)
        const read = (canonical: string) =>
          m[canonical] ? toStringValue(row.rawPayload[m[canonical]!]) || null : null
        const wrote = read('programmeName')
        let suggestion: string | null = null
        if (wrote) {
          let best = { id: '', score: 0 }
          for (const p of programmes) {
            const score = similarity(wrote, p.name)
            if (score > best.score) best = { id: p.roundProgrammeId, score }
          }
          if (best.score >= SUGGEST_THRESHOLD) suggestion = best.id
        }
        return {
          ingestId: row.id,
          organisationName: read('organisationName') ?? 'Unnamed organisation',
          amount: read('amountRequested'),
          receivedAt: row.createdAt,
          programmeWritten: wrote,
          suggestedRoundProgrammeId: suggestion,
        }
      })
    return { rows, programmes }
  })

/**
 * Put a held submission into one of the round's programmes. From here it is promoted
 * exactly as the pipeline would have promoted it (the same assembly, the same checks),
 * and whatever else it is missing is flagged on the application for the same person
 * to fill in.
 */
export const placeSubmission = createServerFn({ method: 'POST' })
  .validator(z.object({ ingestId: z.uuid(), roundProgrammeId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const ingest = await getDb().query.applicationIngests.findFirst({
      where: eq(applicationIngests.id, data.ingestId),
    })
    if (!ingest) throw notFoundError()
    assertClientAccess(user, ingest.clientId)
    if (ingest.applicationId || ingest.status !== 'needs_review') {
      throw conflict('This submission has already been placed.')
    }

    const rp = await fetchRoundProgrammeForApplication(data.roundProgrammeId)
    if (!rp || rp.programme.clientId !== ingest.clientId) throw notFoundError()

    const resolved = resolvedFromMapping(
      ingest.rawPayload,
      mappingOf(ingest.resolved),
      ingest.providedValues ?? {},
    )
    const responses = computeResponses(ingest.rawPayload, resolved, ingest.fieldOrder)
    const parsed = CreateApplicationSchema.safeParse(
      buildCanonicalInput(
        rp.id,
        resolved,
        responses,
        buildSubmittedFields(ingest.rawPayload, resolved, ingest.fieldOrder),
      ),
    )
    if (!parsed.success) {
      throw conflict(
        'This submission has another problem besides its programme, so it cannot be placed here. The Custodian team has it in their queue.',
      )
    }

    const created = await createApplicationFromCanonical(rp, parsed.data, {
      score: 'queued',
      // One fact, one batch: the application and the ingest pointing at it.
      alsoInBatch: (newId, db) =>
        db
          .update(applicationIngests)
          .set({
            status: 'complete',
            applicationId: newId,
            roundProgrammeId: rp.id,
            resolvedAt: new Date(),
            resolvedBy: user.email,
          })
          .where(eq(applicationIngests.id, ingest.id)),
    })
    const applicationId = created.application?.id
    if (!applicationId) throw conflict('The submission could not be placed. Try again.')

    if (parsed.data.amountRequested != null) {
      await enqueue({ kind: 'score', applicationId }, () => scoreApplication(applicationId))
    }
    await recordAudit({
      actorUserId: user.id,
      action: 'application_edited',
      applicationId,
      metadata: { placedIn: rp.programme.name },
    })
    return { applicationId }
  })
