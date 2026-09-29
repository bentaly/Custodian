// Reports that arrived but could not be attached to a grant automatically: no reference,
// or one that matched no grant (or two). Until 2026-09-29 these waited in our admin app;
// now the foundation, who knows which grant a grantee was reporting on, attaches them
// from the Reports screen.
//
// The pipeline already ranks the foundation's grants for each held report (charity
// number, name, programme, amount, year: `reportMapping/match.ts`) and stores that list
// on the row. It is offered as SUGGESTIONS, and nothing attaches without a person
// choosing, for the reason automatic matching stays exact-reference-only: a report on the
// wrong grant ticks the wrong milestone and says a grantee reported when they have not.
//
// Only reports whose ONE problem is the grant are listed here. One whose values cannot
// be read still needs us, in the admin app.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { awards, reportIngests } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { conflict, notFoundError } from '../../lib/errors'
import { toStringValue } from '../../lib/fieldMapping'
import { diagnoseReportIngests } from '../reportMapping/diagnose'
import {
  buildReportCanonicalInput,
  computeReportResponses,
  resolvedFromReportMapping,
} from '../reportMapping/assemble'
import { CreateReportSubmissionSchema } from '../../lib/validators/report'
import { createReportSubmissionFromCanonical, fetchGrantForReport } from '../reports/create'
import { analyseReport } from '../reports/analyse'
import { enqueue } from '../pipelineQueue'
import { recordAudit } from '../audit'

/** `sourceKey -> canonical` (as stored) turned round to `canonical -> sourceKey`. */
function mappingOf(resolved: Record<string, string> | null): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [sourceKey, canonical] of Object.entries(resolved ?? {})) m[canonical] = sourceKey
  return m
}

/** A grant as the picker shows it. */
export type GrantChoice = {
  awardId: string
  organisationName: string
  reference: string | null
  programmeName: string | null
  amountAwarded: number
  awardedOn: string
}

export async function grantChoices(clientId: string): Promise<GrantChoice[]> {
  const rows = await getDb().query.awards.findMany({
    where: eq(awards.clientId, clientId),
    columns: { id: true, amountAwarded: true, decisionAt: true, status: true },
    with: {
      application: {
        columns: { organisationName: true, externalApplicationId: true },
        with: {
          roundProgramme: {
            columns: { id: true },
            with: { programme: { columns: { name: true } } },
          },
        },
      },
    },
    orderBy: [desc(awards.decisionAt)],
  })
  return rows.map((r) => ({
    awardId: r.id,
    organisationName: r.application?.organisationName ?? 'Unknown grantee',
    reference: r.application?.externalApplicationId ?? null,
    programmeName: r.application?.roundProgramme?.programme?.name ?? null,
    amountAwarded: Number(r.amountAwarded),
    awardedOn: r.decisionAt.toISOString().slice(0, 10),
  }))
}

export const listHeldReports = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireRole('superadmin', 'admin')
  // A superadmin has no foundation of their own; they see a foundation's held reports by
  // signing in as a member of it.
  if (!user.clientId) return { reports: [], grants: [] }
  const clientId = user.clientId

  const held = await getDb()
    .select()
    .from(reportIngests)
    .where(
      and(
        eq(reportIngests.clientId, clientId),
        eq(reportIngests.status, 'needs_review'),
        isNull(reportIngests.reportId),
      ),
    )
    .orderBy(desc(reportIngests.createdAt))
    .limit(50)
  if (held.length === 0) return { reports: [], grants: [] }

  const blockers = await diagnoseReportIngests(held)
  const placeable = held.filter((row) => {
    const blocking = (blockers.get(row.id) ?? []).filter((b) => b.severity === 'blocking')
    return blocking.length > 0 && blocking.every((b) => b.code === 'grant_unmatched')
  })
  if (placeable.length === 0) return { reports: [], grants: [] }

  const grants = await grantChoices(clientId)
  const byId = new Map(grants.map((g) => [g.awardId, g]))
  const reports = placeable.map((row) => {
    const m = mappingOf(row.resolved)
    const read = (canonical: string) =>
      m[canonical] ? toStringValue(row.rawPayload[m[canonical]!]) || null : null
    return {
      ingestId: row.id,
      receivedAt: row.createdAt.toISOString(),
      organisationName: read('organisationName'),
      reference: read('externalApplicationId'),
      summary: read('impactSummary'),
      // The pipeline's ranked guesses, best first, with its reasons.
      suggestions: (row.matchCandidates ?? [])
        .filter((c) => byId.has(c.awardId))
        .slice(0, 3)
        .map((c) => ({ ...byId.get(c.awardId)!, reasons: c.reasons })),
    }
  })
  return { reports, grants }
})

/**
 * Attach a held report to the grant a person chose. From here it is created exactly as
 * the pipeline would have created it, ticking that grant's earliest open reporting
 * milestone (movable afterwards from the report itself). The analysis is queued, so
 * the person is not kept waiting for the model.
 */
export const attachHeldReport = createServerFn({ method: 'POST' })
  .validator(z.object({ ingestId: z.uuid(), awardId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const ingest = await getDb().query.reportIngests.findFirst({
      where: eq(reportIngests.id, data.ingestId),
    })
    if (!ingest) throw notFoundError()
    assertClientAccess(user, ingest.clientId)
    if (ingest.reportId || ingest.status !== 'needs_review') {
      throw conflict('This report has already been attached.')
    }
    const grant = await fetchGrantForReport(data.awardId)
    // Never stitch a report onto another foundation's grant.
    if (!grant || grant.clientId !== ingest.clientId) throw notFoundError()

    const resolved = resolvedFromReportMapping(ingest.rawPayload, mappingOf(ingest.resolved))
    const parsed = CreateReportSubmissionSchema.safeParse(
      buildReportCanonicalInput(resolved, computeReportResponses(ingest.rawPayload, resolved)),
    )
    if (!parsed.success) {
      throw conflict(
        'Part of this report could not be read, so it cannot be attached here. The Custodian team has it in their queue.',
      )
    }

    const created = await createReportSubmissionFromCanonical(grant, parsed.data, 'manual', {
      analysis: 'queued',
      receivedAt: ingest.createdAt,
    })
    const reportId = created.submission?.id
    if (!reportId) throw conflict('The report could not be attached. Try again.')
    await getDb()
      .update(reportIngests)
      .set({ status: 'complete', reportId, resolvedAt: new Date(), resolvedBy: user.email })
      .where(eq(reportIngests.id, ingest.id))
    await enqueue({ kind: 'report_analysis', reportId }, () => analyseReport(reportId))
    await recordAudit({
      actorUserId: user.id,
      action: 'report_attached',
      ...(grant.applicationId
        ? { applicationId: grant.applicationId }
        : { clientId: grant.clientId }),
      metadata: { reportId, milestone: created.milestone?.label ?? null },
    })
    return { reportId }
  })

/**
 * Set aside a held report that is not a report on any of this foundation's grants: a
 * test submission, or one sent to the wrong funder. Kept, not deleted (the raw payload
 * stays on the row), and marked with who set it aside and why.
 */
export const dismissHeldReport = createServerFn({ method: 'POST' })
  .validator(z.object({ ingestId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const ingest = await getDb().query.reportIngests.findFirst({
      where: eq(reportIngests.id, data.ingestId),
      columns: { id: true, clientId: true, reportId: true, status: true },
    })
    if (!ingest) throw notFoundError()
    assertClientAccess(user, ingest.clientId)
    if (ingest.reportId || ingest.status !== 'needs_review') {
      throw conflict('This report has already been dealt with.')
    }
    await getDb()
      .update(reportIngests)
      .set({
        status: 'complete',
        note: `Set aside on the Reports screen by ${user.email}: not a report on any of the foundation's grants.`,
        resolvedAt: new Date(),
        resolvedBy: user.email,
      })
      .where(and(eq(reportIngests.id, ingest.id), inArray(reportIngests.status, ['needs_review'])))
    return { ok: true }
  })
