// ─── Ingest diagnosis ────────────────────────────────────────────────────────
//
// Why is this submission sitting in the queue, and what can be done about it?
//
// `processIngest` knows the answer at the moment it decides to hold a row — which
// required field never resolved, that neither register number arrived, that the
// programme name matched nothing open, that the amount wouldn't parse — and then
// throws all of it away, storing a bare `needs_review`. An operator opening the
// admin queue saw a status and a mapping grid and had to reverse-engineer the rest,
// and the validation failures were invisible entirely: a row whose every required
// field IS mapped but whose amount is "£15,000 (approx)" looks, in that grid,
// exactly like a row that is ready to go.
//
// So this module re-derives the reasons from what IS stored — raw payload, resolved
// map, round programme, status — rather than adding a column the pipeline has to
// remember to write. Re-deriving means the answer can never go stale against the
// registry or the validators, and rows held before this shipped explain themselves
// too. It is the same computation `ingest.ts` step 6 runs to decide the status, read
// back out.
//
// Everything here is diagnosis only: nothing writes, and a blocker is advice to a
// human, never a gate. The gates stay in `ingest.ts` and `resolve.ts`.

import { and, eq, inArray, or, isNull, gt, lte } from 'drizzle-orm'
import { getDb } from '../db'
import { programmes, roundProgrammes, rounds } from '../../../drizzle/schema'
// Generic string-similarity helpers. They live under `dataImport` because that is where
// they were first needed, not because they are specific to it — same job here: tell a
// human which known name the one in front of them nearly is.
import { SUGGEST_THRESHOLD, matchReason, similarity } from '../../lib/dataImport/match'
import {
  CANONICAL_FIELD_BY_KEY,
  REQUIRED_CANONICAL_KEYS,
  describeOneOfGroup,
  unmetOneOfGroups,
  type CanonicalFieldKey,
} from '../../lib/fieldMapping'
import { buildCanonicalInput, computeResponses, resolvedFromMapping } from './assemble'
import { CreateApplicationSchema } from '../../lib/validators/application'

/** A submission is judged stuck once the background pipeline has had this long. */
export const STUCK_AFTER_MS = 5 * 60 * 1000

const PLACEHOLDER_ROUND_PROGRAMME_ID = '00000000-0000-0000-0000-000000000000'

export type IngestBlockerCode =
  | 'pipeline_running'
  | 'pipeline_stalled'
  | 'programme_unmapped'
  | 'programme_unknown'
  | 'programme_not_open'
  | 'required_unmapped'
  | 'one_of_unmet'
  | 'invalid_value'
  // Reports only (see server/reportMapping/diagnose.ts): held for want of a grant
  // to attach to. Lives in this union so the admin app has one blocker type.
  | 'grant_unmatched'

export interface IngestBlocker {
  code: IngestBlockerCode
  /** Blocks promotion, or merely worth knowing. */
  severity: 'blocking' | 'info'
  /** One line, plain English: what is wrong. */
  title: string
  /** Why the pipeline stopped here and what it means downstream. */
  detail: string
  /** What the operator should do about it, in this app. */
  fix: string
  /** The canonical fields this blocker is about, for highlighting the mapping grid. */
  fields?: Array<{ key: string; label: string; message?: string }>
}

/** The rows this module needs; a subset of the `application_ingests` row. */
export interface DiagnosableIngest {
  id: string
  clientId: string
  status: 'received' | 'needs_review' | 'ai_proposed' | 'complete'
  rawPayload: Record<string, unknown>
  resolved: Record<string, string> | null
  roundProgrammeId: string | null
  applicationId: string | null
  createdAt: Date | string
}

/** `sourceKey → canonicalField` (as stored) inverted to `canonicalField → sourceKey`. */
function mappingFromResolved(resolved: Record<string, string> | null): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [sourceKey, canonical] of Object.entries(resolved ?? {})) m[canonical] = sourceKey
  return m
}

function labelFor(key: string): string {
  return CANONICAL_FIELD_BY_KEY[key as CanonicalFieldKey]?.label ?? key
}

/**
 * Every programme name a client has, and whether any pairing of it sits in an open
 * round. Fetched once for the whole page of ingests rather than per row — the list
 * endpoint renders up to a few hundred, and this is the only IO diagnosis needs.
 */
interface ProgrammeIndex {
  /** clientId → the client's programme names as spelled, for suggesting a near miss. */
  names: Map<string, string[]>
  /** clientId → lowercased programme names that exist at all. */
  known: Map<string, Set<string>>
  /** clientId → lowercased programme names currently in an open round. */
  open: Map<string, Set<string>>
}

/** The form both sides of a programme-name comparison are reduced to. Mirrors
 *  `findActiveRoundProgrammeByName`, which the pipeline actually routes on — if the two
 *  ever diverge the queue starts explaining a hold that isn't happening, or worse, fails
 *  to explain one that is. Trimmed because a name stored with a trailing space is
 *  invisible on every screen that renders it, and cost us a whole afternoon. */
function routingKey(name: string): string {
  return name.trim().toLowerCase()
}

async function loadProgrammeIndex(clientIds: string[]): Promise<ProgrammeIndex> {
  const names = new Map<string, string[]>()
  const known = new Map<string, Set<string>>()
  const open = new Map<string, Set<string>>()
  if (clientIds.length === 0) return { names, known, open }

  const db = getDb()
  const now = new Date()

  const [all, openRows] = await Promise.all([
    db
      .select({ clientId: programmes.clientId, name: programmes.name })
      .from(programmes)
      .where(inArray(programmes.clientId, clientIds)),
    db
      .select({ clientId: programmes.clientId, name: programmes.name })
      .from(roundProgrammes)
      .innerJoin(rounds, eq(roundProgrammes.roundId, rounds.id))
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(
        and(
          inArray(programmes.clientId, clientIds),
          lte(rounds.openedAt, now),
          or(isNull(rounds.closedAt), gt(rounds.closedAt, now)),
        ),
      ),
  ])

  for (const r of all) {
    const set = known.get(r.clientId) ?? new Set<string>()
    set.add(routingKey(r.name))
    known.set(r.clientId, set)
    const list = names.get(r.clientId) ?? []
    list.push(r.name.trim())
    names.set(r.clientId, list)
  }
  for (const r of openRows) {
    const set = open.get(r.clientId) ?? new Set<string>()
    set.add(routingKey(r.name))
    open.set(r.clientId, set)
  }
  return { names, known, open }
}

/**
 * Diagnose a page of ingests. Batched so the programme lookup is one pair of
 * queries for the whole list rather than one per held row.
 */
export async function diagnoseIngests(
  rows: DiagnosableIngest[],
): Promise<Map<string, IngestBlocker[]>> {
  // Only rows that could name a programme they never routed to need the index.
  const clientIds = [...new Set(rows.filter((r) => !r.roundProgrammeId).map((r) => r.clientId))]
  const index = await loadProgrammeIndex(clientIds)
  return new Map(rows.map((row) => [row.id, diagnoseIngest(row, index)]))
}

/** The blockers on one ingest. Pure — all IO is in the pre-loaded `index`. */
/**
 * What to actually do about a programme name that matched nothing.
 *
 * "Programme names are matched exactly" is true and useless on its own: the operator is
 * staring at a name that LOOKS right, with no way to see which of the foundation's
 * programmes it nearly is. So name the closest one and say how it differs — the same
 * `matchReason` phrasing the data-import review screen uses, for the same reason ("differs
 * by spacing or punctuation" is instantly checkable in a way that a score never is).
 *
 * A suggestion only. Routing is decided by `findActiveRoundProgrammeByName`, and nothing
 * here relaxes it: a blocker is advice to a human, never a gate. Which is also why a near
 * miss is never silently applied — two programmes can sit one character apart, and picking
 * between them is a judgement about which grant this is, not a string operation.
 */
function nearestProgrammeAdvice(programmeName: string, candidates: string[]): string {
  const correct =
    'Use Edit & resend to correct the name, or add a lookup so the foundation’s wording maps to the right programme in future.'
  if (candidates.length === 0) {
    return `This foundation has no programmes yet — create one in the main app, put it in an open round, then Reprocess. ${correct}`
  }

  let best: { name: string; score: number } | null = null
  for (const candidate of candidates) {
    const score = similarity(programmeName, candidate)
    if (!best || score > best.score) best = { name: candidate, score }
  }

  if (best && best.score >= SUGGEST_THRESHOLD) {
    return `Did you mean “${best.name}”? It ${matchReason(programmeName, best.name)}. ${correct}`
  }
  const list = candidates.slice(0, 6).join('”, “')
  const more = candidates.length > 6 ? `, and ${candidates.length - 6} more` : ''
  return `This foundation's programmes are “${list}”${more}. ${correct}`
}

export function diagnoseIngest(row: DiagnosableIngest, index: ProgrammeIndex): IngestBlocker[] {
  // A row still at `received` has never been through the pipeline, so there is
  // nothing to diagnose yet — only whether it is taking suspiciously long. The
  // distinction matters: "running" is patience, "stalled" is a crashed background
  // run and the only thing that will move it is Reprocess.
  if (row.status === 'received') {
    const ageMs = Date.now() - new Date(row.createdAt).getTime()
    return ageMs < STUCK_AFTER_MS
      ? [
          {
            code: 'pipeline_running',
            severity: 'info',
            title: 'Still processing',
            detail:
              'The submission is stored and safe. Field mapping, the Custodian score, due diligence and the deprivation lookup are running in the background — this normally takes a few seconds.',
            fix: 'Refresh in a moment. Nothing to do unless it is still here in five minutes.',
          },
        ]
      : [
          {
            code: 'pipeline_stalled',
            severity: 'blocking',
            title: 'Background processing never finished',
            detail:
              'This row has sat unprocessed for more than five minutes, which means the background run crashed — most often an external register or the AI call throwing. The raw payload is intact; no application was created, and nothing was half-written.',
            fix: 'Press Reprocess to run the pipeline again, inline this time, so you see the outcome immediately. If it fails repeatedly, the reason is in Workers Logs.',
          },
        ]
  }

  // Promoted rows have no blockers; `ai_proposed` is awaiting confirmation, not blocked.
  if (row.status === 'complete') return []

  const blockers: IngestBlocker[] = []
  const mapping = mappingFromResolved(row.resolved)
  const resolved = resolvedFromMapping(row.rawPayload, mapping)
  const resolvedKeys = Object.keys(resolved)

  if (row.status === 'ai_proposed') {
    return [
      {
        code: 'required_unmapped',
        severity: 'info',
        title: 'Created from an AI-proposed mapping, awaiting your confirmation',
        detail:
          'The model was confident enough (over 85%) about a required field for the application to be created straight away, but a human has not yet agreed the mapping was right.',
        fix: 'Check the mapping below. Tick “lookup” on anything worth teaching this foundation’s table, then Confirm — it will not create a second application.',
      },
    ]
  }

  // 1. Required fields that never resolved.
  const missingRequired = REQUIRED_CANONICAL_KEYS.filter((k) => !resolved[k])
  if (missingRequired.length > 0) {
    blockers.push({
      code: 'required_unmapped',
      severity: 'blocking',
      title: `${missingRequired.length} required field${missingRequired.length === 1 ? '' : 's'} could not be matched`,
      detail:
        'Neither this foundation’s lookup table, the built-in dictionary of common field names, nor the AI fallback could work out which incoming field holds these. An application cannot exist without them.',
      fix: 'Pick the right incoming field for each below. Tick “lookup” as you go so the next submission using the same field name maps itself.',
      fields: missingRequired.map((k) => ({ key: k, label: labelFor(k) })),
    })
  }

  // 2. One-of groups (charity number / company number) with neither member resolved.
  for (const group of unmetOneOfGroups(resolvedKeys)) {
    blockers.push({
      code: 'one_of_unmet',
      severity: 'blocking',
      title: `No ${describeOneOfGroup(group)} arrived`,
      detail:
        'Neither number is required on its own — an applicant may be a charity, a company, or both — but with neither there is no register to look the organisation up in, so due diligence can never run for this application. It is held rather than promoted so nobody sees an application that looks screened and never was.',
      fix: 'Map whichever number this applicant supplied. If they genuinely have neither, this submission cannot be screened; delete it or take it up with the foundation.',
      fields: group.map((k) => ({ key: k, label: labelFor(k) })),
    })
  }

  // 3. Routing: the submission named a programme that isn't in an open round.
  if (!row.roundProgrammeId) {
    const programmeName = resolved.programmeName?.value ?? null
    if (!programmeName) {
      blockers.push({
        code: 'programme_unmapped',
        severity: 'blocking',
        title: 'No programme name to route on',
        detail:
          'Nothing in the payload was matched to the programme name, so there is no way to tell which round-programme this application belongs to.',
        fix: 'Map the incoming field that names the programme. If the submission genuinely omits it, use Edit & resend to add one.',
        fields: [{ key: 'programmeName', label: labelFor('programmeName') }],
      })
    } else {
      const key = routingKey(programmeName)
      const knownHere = index.known.get(row.clientId)?.has(key) ?? false
      const openHere = index.open.get(row.clientId)?.has(key) ?? false
      if (!openHere) {
        blockers.push(
          knownHere
            ? {
                code: 'programme_not_open',
                severity: 'blocking',
                title: `“${programmeName}” has no open round`,
                detail:
                  'The programme exists for this foundation, but no round containing it is open right now — either the round closed before the submission arrived, or it has not opened yet.',
                fix: 'Reopen or extend the round in the main app, then Reprocess. Or use Edit & resend to route this one at a programme that is open.',
                fields: [{ key: 'programmeName', label: labelFor('programmeName') }],
              }
            : {
                code: 'programme_unknown',
                severity: 'blocking',
                title: `No programme called “${programmeName}”`,
                detail:
                  'The name matched no programme belonging to this foundation. Programme names are matched exactly (case-insensitively, ignoring surrounding spaces), so this is usually a typo, a renamed programme, or the foundation’s form offering a label that differs from the programme’s name.',
                fix: nearestProgrammeAdvice(programmeName, index.names.get(row.clientId) ?? []),
                fields: [{ key: 'programmeName', label: labelFor('programmeName') }],
              },
        )
      }
    }
  }

  // 4. Fields that DID map but hold a value the validators reject. This is the one
  //    the old queue could not show at all: the mapping grid looks complete, and the
  //    row sits in `needs_review` with nothing to explain it. Issues on fields already
  //    reported as unmapped are dropped — they'd just say "required" twice — as is
  //    anything rooted at the placeholder round programme.
  const responses = computeResponses(row.rawPayload, resolved)
  const candidate = buildCanonicalInput(
    row.roundProgrammeId ?? PLACEHOLDER_ROUND_PROGRAMME_ID,
    resolved,
    responses,
  )
  const parsed = CreateApplicationSchema.safeParse(candidate)
  if (!parsed.success) {
    const missingSet = new Set<string>(missingRequired)
    const issues = parsed.error.issues
      .map((i) => ({ field: String(i.path[0] ?? ''), message: i.message }))
      .filter((i) => i.field && i.field !== 'roundProgrammeId' && !missingSet.has(i.field))
    if (issues.length > 0) {
      blockers.push({
        code: 'invalid_value',
        severity: 'blocking',
        title: `${issues.length} mapped field${issues.length === 1 ? '' : 's'} hold${issues.length === 1 ? 's' : ''} a value that isn’t valid`,
        detail:
          'These fields matched an incoming field, but the value in it fails validation — an amount that will not parse as a number, a sort code of the wrong shape, an email that is not one. The mapping grid alone cannot show this, which is why a row can look fully mapped and still be held.',
        fix: 'Either map the field to a different incoming value, or use Edit & resend to correct the value at source and put it back through the pipeline.',
        fields: issues.map((i) => ({
          key: i.field,
          label: labelFor(i.field),
          message: i.message,
        })),
      })
    }
  }

  // A held row with nothing above to explain it means the pipeline's view and this
  // re-derivation disagree — say so rather than render an empty panel, which would
  // read as "no problem" on a row that is demonstrably stuck.
  if (blockers.length === 0) {
    blockers.push({
      code: 'required_unmapped',
      severity: 'info',
      title: 'Held, but everything now checks out',
      detail:
        'This submission was held when it arrived, but re-checking it against the current registry, programmes and validators finds nothing blocking. Usually that means the thing in its way has since been fixed — a round reopened, a lookup added, a programme renamed back.',
      fix: 'Resolve it with the mapping below to create the application.',
    })
  }

  return blockers
}
