// ─── Report → grant matching ─────────────────────────────────────────────────
//
// Two very different jobs, deliberately separated:
//
//   findGrantByExternalApplicationId — the ONLY automated link. A report whose
//   externalApplicationId exactly matches one application with a grant links to
//   that grant; anything else (no ID, unknown ID, or — pathologically — the same
//   ID on several awards) is held for review.
//
//   findGrantByCharityNumber — the second automated link, for a report with no
//   usable reference. A registered charity number is an identifier, not free text,
//   so it may link on its own, but only where the answer is not a guess: exactly
//   one of the charity's live grants is still waiting on a report, or the report
//   names a programme and exactly one of those waiting grants is in it. Several
//   grants waiting and nothing to choose between them holds the report, however
//   likely one of them looks. "Two awards" versus "two periodic reports on one
//   grant" (below) is not the question here: the grant is settled first, and the
//   report takes that grant's earliest open milestone.
//
//   computeGrantCandidates — advisory heuristics for the review queue. Charity
//   number, normalised organisation name and programme
//   RANK the client's awards so the reviewer confirms in one click, but on
//   their own (names, amounts, years) they never auto-link: real data (Arete's Typeform exports) shows name+amount
//   cannot distinguish "two awards" from "two periodic reports on one grant".

import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applications,
  awards,
  programmes,
  reportSchedule,
  roundProgrammes,
} from '../../../drizzle/schema'

export interface GrantCandidate {
  awardId: string
  score: number
  reasons: string[]
}

export type ExternalIdMatch =
  | { kind: 'matched'; awardId: string }
  | { kind: 'ambiguous'; grantIds: string[] }
  | { kind: 'none' }

/** Exact (case-insensitive) externalApplicationId → the application's grant. */
export async function findGrantByExternalApplicationId(
  clientId: string,
  externalApplicationId: string,
): Promise<ExternalIdMatch> {
  const rows = await getDb()
    .select({ awardId: awards.id })
    .from(awards)
    .innerJoin(applications, eq(awards.applicationId, applications.id))
    .where(
      and(
        eq(awards.clientId, clientId),
        sql`lower(${applications.externalApplicationId}) = lower(${externalApplicationId})`,
      ),
    )
  if (rows.length === 1) return { kind: 'matched', awardId: rows[0]!.awardId }
  if (rows.length > 1) return { kind: 'ambiguous', grantIds: rows.map((r) => r.awardId) }
  return { kind: 'none' }
}

export interface WaitingGrant {
  awardId: string
  programmeName: string | null
}

/**
 * The rule behind `findGrantByCharityNumber`, given the charity's live grants that
 * still have an open reporting milestone. Returns the one grant the report can only
 * belong to, or null to hold it for a person.
 */
export function pickWaitingGrant(
  waiting: WaitingGrant[],
  programmeName: string | null | undefined,
): string | null {
  const ids = [...new Set(waiting.map((g) => g.awardId))]
  if (ids.length === 1) return ids[0]!
  const wanted = programmeName?.trim().toLowerCase()
  if (!wanted || ids.length === 0) return null
  const inProgramme = [
    ...new Set(
      waiting.filter((g) => g.programmeName?.trim().toLowerCase() === wanted).map((g) => g.awardId),
    ),
  ]
  return inProgramme.length === 1 ? inProgramme[0]! : null
}

/**
 * Exact charity number → the one live grant still waiting on a report. Cancelled
 * grants are owed nothing, and a grant with every milestone answered is not waiting,
 * so neither can take a report automatically; a person can still attach one there.
 */
export async function findGrantByCharityNumber(
  clientId: string,
  charityNumber: string,
  programmeName?: string | null,
): Promise<string | null> {
  const wanted = normaliseCharityNumber(charityNumber)
  if (!wanted) return null
  const rows = await getDb()
    .selectDistinct({ awardId: awards.id, programmeName: programmes.name })
    .from(awards)
    .innerJoin(applications, eq(awards.applicationId, applications.id))
    .innerJoin(reportSchedule, eq(reportSchedule.awardId, awards.id))
    .leftJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .leftJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
    .where(
      and(
        eq(awards.clientId, clientId),
        ne(awards.status, 'cancelled'),
        isNull(reportSchedule.submittedDate),
        // The same normalisation as `normaliseCharityNumber`, in SQL.
        sql`regexp_replace(lower(${applications.charityNumber}), '[^a-z0-9]', '', 'g') = ${wanted}`,
      ),
    )
  return pickWaitingGrant(rows, programmeName)
}

/** Lowercase, strip punctuation, drop legal suffixes — "The Inclusive Hub CIC"
 *  and "inclusive hub" compare equal. */
export function normaliseOrgName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’`.,()&]/g, ' ')
    .replace(/\b(cic|cio|ltd|limited|plc|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Digits/letters only, lowercased — "1143231-2" and "1143231 2" compare equal.
 *  Returns '' for junk values ("N/A", "1234") too weak to match on. */
export function normaliseCharityNumber(num: string): string {
  const n = num.toLowerCase().replace(/[^a-z0-9]/g, '')
  return n.length >= 5 ? n : ''
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let common = 0
  for (const t of ta) if (tb.has(t)) common++
  return common / Math.max(ta.size, tb.size)
}

export interface CandidateHints {
  charityNumber?: string | null
  organisationName?: string | null
  programmeName?: string | null
}

/** Rank the client's awards as candidates for a held report. Advisory only. */
export async function computeGrantCandidates(
  clientId: string,
  hints: CandidateHints,
): Promise<GrantCandidate[]> {
  // Every award the foundation has ever made is scored, so this asks for the few
  // fields the scoring below reads and nothing else. Left as `SELECT *` it pulled each
  // award's whole application — five jsonb columns of responses, AI analysis and budget
  // lines — on every single report submission. That is tens of MB for a foundation with
  // years of grants, spent inside a background pipeline where running out of memory
  // would leave an ingest stuck at `received` with no one watching.
  const clientAwards = await getDb().query.awards.findMany({
    where: eq(awards.clientId, clientId),
    columns: { id: true },
    with: {
      application: {
        columns: { charityNumber: true, organisationName: true },
        with: {
          roundProgramme: {
            columns: { id: true },
            with: { programme: { columns: { name: true } } },
          },
        },
      },
    },
  })

  const hintCharity = hints.charityNumber ? normaliseCharityNumber(hints.charityNumber) : ''
  const hintOrg = hints.organisationName ? normaliseOrgName(hints.organisationName) : ''
  const hintProgramme = hints.programmeName?.trim().toLowerCase() ?? ''

  const candidates: GrantCandidate[] = []
  for (const g of clientAwards) {
    const app = g.application
    let score = 0
    const reasons: string[] = []

    if (
      hintCharity &&
      app?.charityNumber &&
      normaliseCharityNumber(app.charityNumber) === hintCharity
    ) {
      score += 50
      reasons.push('Charity number matches')
    }
    if (hintOrg && app?.organisationName) {
      const grantOrg = normaliseOrgName(app.organisationName)
      if (grantOrg === hintOrg) {
        score += 30
        reasons.push('Organisation name matches')
      } else if (tokenOverlap(grantOrg, hintOrg) >= 0.6) {
        score += 12
        reasons.push('Organisation name similar')
      }
    }
    const programmeName = app?.roundProgramme?.programme?.name
    if (hintProgramme && programmeName && programmeName.toLowerCase() === hintProgramme) {
      score += 8
      reasons.push('Programme matches')
    }

    if (score >= 12) candidates.push({ awardId: g.id, score, reasons })
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5)
}
