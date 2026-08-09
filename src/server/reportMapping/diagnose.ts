// ─── Report ingest diagnosis ─────────────────────────────────────────────────
//
// The report-side twin of `server/fieldMapping/diagnose.ts` — see that file's
// header for why the reasons are re-derived rather than stored.
//
// Reports have one blocker applications don't: no grant. Auto-linking happens only
// on an exact `externalApplicationId` hit, deliberately, because attaching a report
// to the wrong grant ticks the wrong milestone and tells a foundation a grantee has
// reported when they haven't. Everything else waits for a human — so "held" is the
// designed outcome here far more often than it is a fault, and the queue needs to
// say which of the two it is looking at.

import { getDb } from '../db'
import { awards } from '../../../drizzle/schema'
import { inArray } from 'drizzle-orm'
import {
  REPORT_CANONICAL_FIELD_BY_KEY,
  REQUIRED_REPORT_CANONICAL_KEYS,
  type ReportCanonicalFieldKey,
} from '../../lib/fieldMapping'
import {
  buildReportCanonicalInput,
  computeReportResponses,
  resolvedFromReportMapping,
} from './assemble'
import { CreateReportSubmissionSchema } from '../../lib/validators/report'
import { STUCK_AFTER_MS, type IngestBlocker } from '../fieldMapping/diagnose'

export interface DiagnosableReportIngest {
  id: string
  clientId: string
  status: 'received' | 'needs_review' | 'ai_proposed' | 'complete'
  rawPayload: Record<string, unknown>
  resolved: Record<string, string> | null
  matchCandidates: Array<{ awardId: string; score: number; reasons: string[] }> | null
  reportId: string | null
  createdAt: Date | string
}

function labelFor(key: string): string {
  return REPORT_CANONICAL_FIELD_BY_KEY[key as ReportCanonicalFieldKey]?.label ?? key
}

/** Clients that have at least one grant on record — a report for a foundation with
 *  no grants at all cannot be matched by anyone, which is worth saying plainly. */
async function loadClientsWithGrants(clientIds: string[]): Promise<Set<string>> {
  if (clientIds.length === 0) return new Set()
  const rows = await getDb()
    .selectDistinct({ clientId: awards.clientId })
    .from(awards)
    .where(inArray(awards.clientId, clientIds))
  return new Set(rows.map((r) => r.clientId))
}

export async function diagnoseReportIngests(
  rows: DiagnosableReportIngest[],
): Promise<Map<string, IngestBlocker[]>> {
  const clientIds = [
    ...new Set(rows.filter((r) => !r.reportId && r.status !== 'complete').map((r) => r.clientId)),
  ]
  const withGrants = await loadClientsWithGrants(clientIds)
  return new Map(rows.map((row) => [row.id, diagnoseReportIngest(row, withGrants)]))
}

export function diagnoseReportIngest(
  row: DiagnosableReportIngest,
  clientsWithGrants: Set<string>,
): IngestBlocker[] {
  if (row.status === 'received') {
    const ageMs = Date.now() - new Date(row.createdAt).getTime()
    return ageMs < STUCK_AFTER_MS
      ? [
          {
            code: 'pipeline_running',
            severity: 'info',
            title: 'Still processing',
            detail:
              'The report is stored and safe. Field mapping, grant matching and the AI analysis are running in the background.',
            fix: 'Refresh in a moment. Nothing to do unless it is still here in five minutes.',
          },
        ]
      : [
          {
            code: 'pipeline_stalled',
            severity: 'blocking',
            title: 'Background processing never finished',
            detail:
              'This report has sat unprocessed for more than five minutes, so the background run crashed. The raw payload is intact and no submission was created.',
            fix: 'Resolve it by hand below — map the fields and pick its grant. The crash reason is in Workers Logs.',
          },
        ]
  }

  if (row.status === 'complete') return []

  const blockers: IngestBlocker[] = []
  const mapping: Record<string, string> = {}
  for (const [sourceKey, canonical] of Object.entries(row.resolved ?? {})) mapping[canonical] = sourceKey
  const resolved = resolvedFromReportMapping(row.rawPayload, mapping)

  if (row.status === 'ai_proposed') {
    return [
      {
        code: 'required_unmapped',
        severity: 'info',
        title: 'Created from an AI-proposed mapping, awaiting your confirmation',
        detail:
          'The model cleared the confidence threshold on a required field, so the submission was created and its reporting milestone ticked. Nobody has yet agreed the mapping was right.',
        fix: 'Check the mapping below, tick “lookup” for anything worth teaching, then Confirm.',
      },
    ]
  }

  const missingRequired = REQUIRED_REPORT_CANONICAL_KEYS.filter((k) => !resolved[k])
  if (missingRequired.length > 0) {
    blockers.push({
      code: 'required_unmapped',
      severity: 'blocking',
      title: `${missingRequired.length} required field${missingRequired.length === 1 ? '' : 's'} could not be matched`,
      detail:
        'The foundation’s report lookup table, the built-in dictionary and the AI fallback all failed to find these in the payload.',
      fix: 'Pick the right incoming field for each below, ticking “lookup” to teach the foundation’s report-field table.',
      fields: missingRequired.map((k) => ({ key: k, label: labelFor(k) })),
    })
  }

  if (!row.reportId) {
    const candidates = row.matchCandidates?.length ?? 0
    const hasGrants = clientsWithGrants.has(row.clientId)
    const externalId = resolved.externalApplicationId?.value ?? null
    blockers.push(
      !hasGrants
        ? {
            code: 'grant_unmatched',
            severity: 'blocking',
            title: 'This foundation has no grants on record',
            detail:
              'A report has to be attached to a grant before it can tick a reporting milestone, and there is nothing here to attach it to.',
            fix: 'The report stays held until the grant it belongs to is created or imported. Nothing to do here in the meantime.',
          }
        : {
            code: 'grant_unmatched',
            severity: 'blocking',
            title: candidates
              ? `Needs a grant confirming (${candidates} likely ${candidates === 1 ? 'match' : 'matches'})`
              : 'Needs a grant choosing — no confident match',
            detail: externalId
              ? `A report is auto-linked only when its application reference matches exactly one grant. “${externalId}” did not, so the link is left to a human — attaching a report to the wrong grant ticks the wrong milestone and tells the foundation a grantee has reported when they have not.`
              : 'No application reference was mapped, and that exact match is the only automatic linking path. The suggestions below are heuristic — organisation name, amount, dates — and are advisory only.',
            fix: 'Pick the grant this report belongs to from the list below, then Resolve.',
          },
    )
  }

  const responses = computeReportResponses(row.rawPayload, resolved)
  const parsed = CreateReportSubmissionSchema.safeParse(buildReportCanonicalInput(resolved, responses))
  if (!parsed.success) {
    const missingSet = new Set<string>(missingRequired)
    const issues = parsed.error.issues
      .map((i) => ({ field: String(i.path[0] ?? ''), message: i.message }))
      .filter((i) => i.field && !missingSet.has(i.field))
    if (issues.length > 0) {
      blockers.push({
        code: 'invalid_value',
        severity: 'blocking',
        title: `${issues.length} mapped field${issues.length === 1 ? '' : 's'} hold${issues.length === 1 ? 's' : ''} a value that isn’t valid`,
        detail:
          'These fields matched an incoming field, but the value fails validation. The mapping grid alone cannot show this, which is why a report can look fully mapped and still be held.',
        fix: 'Map the field to a different incoming value, or fix it at source and resubmit.',
        fields: issues.map((i) => ({ key: i.field, label: labelFor(i.field), message: i.message })),
      })
    }
  }

  if (blockers.length === 0) {
    blockers.push({
      code: 'required_unmapped',
      severity: 'info',
      title: 'Held, but everything now checks out',
      detail:
        'Re-checking this report against the current registry and validators finds nothing blocking.',
      fix: 'Resolve it with the mapping below to create the submission.',
    })
  }

  return blockers
}
