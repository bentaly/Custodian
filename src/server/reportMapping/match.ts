// ─── Report → grant matching ─────────────────────────────────────────────────
//
// Two very different jobs, deliberately separated:
//
//   findGrantByExternalApplicationId — the ONLY automated link. A report whose
//   externalApplicationId exactly matches one application with a grant links to
//   that grant; anything else (no ID, unknown ID, or — pathologically — the same
//   ID on several awards) is held for review.
//
//   computeGrantCandidates — advisory heuristics for the review queue. Charity
//   number, normalised organisation name, programme, amount and award-date fit
//   RANK the client's awards so the reviewer confirms in one click, but they
//   never auto-link: real data (Arete's Typeform exports) shows name+amount
//   cannot distinguish "two awards" from "two periodic reports on one grant".

import { and, eq, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, awards } from '../../../drizzle/schema'

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
  amountAwarded?: number | null
  awardDate?: string | null
}

/** Rank the client's awards as candidates for a held report. Advisory only. */
export async function computeGrantCandidates(
  clientId: string,
  hints: CandidateHints,
): Promise<GrantCandidate[]> {
  const clientAwards = await getDb().query.awards.findMany({
    where: eq(awards.clientId, clientId),
    with: {
      application: {
        with: { roundProgramme: { with: { programme: true } } },
      },
    },
  })

  const hintCharity = hints.charityNumber ? normaliseCharityNumber(hints.charityNumber) : ''
  const hintOrg = hints.organisationName ? normaliseOrgName(hints.organisationName) : ''
  const hintProgramme = hints.programmeName?.trim().toLowerCase() ?? ''
  const hintYear = hints.awardDate?.match(/\b(20\d\d)\b/)?.[1] ?? ''

  const candidates: GrantCandidate[] = []
  for (const g of clientAwards) {
    const app = g.application
    let score = 0
    const reasons: string[] = []

    if (hintCharity && app?.charityNumber && normaliseCharityNumber(app.charityNumber) === hintCharity) {
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
    if (hints.amountAwarded && Number(g.amountAwarded) > 0) {
      const diff = Math.abs(hints.amountAwarded - Number(g.amountAwarded)) / Number(g.amountAwarded)
      if (diff <= 0.15) {
        score += 8
        reasons.push('Amount matches grant')
      }
    }
    if (hintYear && g.decisionAt && String(g.decisionAt.getFullYear()) === hintYear) {
      score += 4
      reasons.push('Award year matches')
    }

    if (score >= 12) candidates.push({ awardId: g.id, score, reasons })
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5)
}
