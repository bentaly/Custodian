// ─── Matching a grant that arrived with no reference of its own ─────────────
//
// The workbook's Application reference is the join key for everything: the Payments and
// Reports sheets hang off it, and above all a RE-UPLOAD matches on it, replacing a grant
// rather than adding a second one. Re-uploading is the phasing mechanism (live grants
// first, history later, bank details once somebody digs them out), so matching is the
// whole thing working.
//
// Foundations that have never used references of their own are told, by our own
// template, to leave the column blank, and `IMP-0001` onwards is minted for them. That
// left exactly those foundations unable to re-upload at all: a blank column means no
// reference to match on, so nothing matched, nothing was replaced, and the second upload
// minted IMP-0009 onwards alongside the first eight. The whole portfolio, twice, with
// every total on every screen doubled — and only for the foundations that followed the
// advice we gave them.
//
// So a blank row is matched on what it does have: who the grant went to, when it was
// awarded, and for how much. That is not a primary key, and it is not pretending to be.
// It is what a person means by "that is the same grant", and the thing it is weighed
// against is not a perfect match, it is a guaranteed duplicate.
//
// Ambiguity is never resolved by guessing. An identity shared by two grants — a
// foundation that gave one charity two grants of the same size on the same day — matches
// NOTHING on either side, and both rows are reported as new. A wrong match would overwrite
// the wrong grant's schedule; a duplicate is visible and can be rolled back.

import { normalise } from './match'

export type IdentifiableGrant = {
  rowNumber: number
  reference: string
  organisationName: string
  awardDate: string
  amountAwarded: number
}

/** A grant already in Custodian that an import put there. */
export type ExistingGrantIdentity = {
  reference: string
  organisationName: string
  awardDate: string
  amountAwarded: number
}

/**
 * The three facts that stand in for a reference, folded to a single key.
 *
 * The organisation name goes through the same `normalise` the programme and round
 * matcher uses, so "St. Mary's Trust" and "St Marys Trust" are one grantee. The date is
 * already ISO. The amount is fixed to two places so 45000 and 45000.00 agree.
 */
export function grantIdentity(grant: {
  organisationName: string
  awardDate: string
  amountAwarded: number
}): string {
  return [
    // Apostrophes are DROPPED before the shared fold rather than turned into a space by
    // it, so "St Mary's Trust" and "St Marys Trust" are one grantee. `normalise` is used
    // by the programme and round matcher too, where a suggestion is confirmed by a human
    // and an over-eager fold costs nothing; here the answer is applied without asking, so
    // the one difference that is never meaningful in an organisation's name is folded and
    // nothing else is.
    normalise(grant.organisationName.replace(/['’`]/g, '')),
    grant.awardDate,
    grant.amountAwarded.toFixed(2),
  ].join('|')
}

export type ReferenceMatch = {
  /** Row number → the reference an existing grant already carries, so it is replaced. */
  byRow: Map<number, string>
  /** Blank rows that matched nothing, and will therefore be added as new grants. */
  unmatchedRows: number[]
}

/**
 * Work out which blank-reference rows are grants Custodian already holds.
 *
 * Rows that carry a reference are left alone entirely: the foundation has said what this
 * grant is, and no derived identity gets to second-guess it.
 */
export function matchBlankReferences(
  grants: IdentifiableGrant[],
  existing: ExistingGrantIdentity[],
): ReferenceMatch {
  const blanks = grants.filter((g) => !g.reference.trim())
  const byRow = new Map<number, string>()
  const unmatchedRows: number[] = []
  if (blanks.length === 0) return { byRow, unmatchedRows }

  // An identity held by more than one existing grant cannot single anything out.
  const existingByIdentity = new Map<string, string[]>()
  for (const e of existing) {
    const key = grantIdentity(e)
    existingByIdentity.set(key, [...(existingByIdentity.get(key) ?? []), e.reference])
  }

  // Nor can one held by more than one row of the incoming file: two identical rows have
  // no way to say which of them is the grant on record.
  const incomingCounts = new Map<string, number>()
  for (const g of blanks) {
    const key = grantIdentity(g)
    incomingCounts.set(key, (incomingCounts.get(key) ?? 0) + 1)
  }

  // A reference can only be claimed once, whatever the identities say.
  const claimed = new Set<string>()

  for (const g of blanks) {
    const key = grantIdentity(g)
    const candidates = existingByIdentity.get(key) ?? []
    const unique = candidates.length === 1 && incomingCounts.get(key) === 1
    const reference = unique ? candidates[0]! : undefined
    if (reference && !claimed.has(reference.toLowerCase())) {
      claimed.add(reference.toLowerCase())
      byRow.set(g.rowNumber, reference)
    } else {
      unmatchedRows.push(g.rowNumber)
    }
  }

  return { byRow, unmatchedRows }
}
