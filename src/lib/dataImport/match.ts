// ─── Matching a spreadsheet cell to something that already exists ────────────
//
// The generated template puts the foundation's real programmes and rounds behind
// dropdowns, so a hand-typed file needs none of this. But Excel's data validation
// does not fire on PASTE, and pasting a column out of an old export is exactly what
// people do — so a value that was never offered still arrives, silently.
//
// Deliberately small. The review screen always offers a plain dropdown of every
// candidate as a fallback, so a mediocre suggestion costs one click; it is never a
// silent wrong answer. That is why there is no Dice coefficient, no confidence
// banding and no token-set scoring here — all of it was defending against a failure
// the UI already prevents. Only an exact match after normalisation is ever applied
// without a human confirming it.

/**
 * Fold away the differences that are not real differences: case, padding, the
 * ampersand/"and" split, punctuation, and accents. Two strings equal after this are
 * the same name typed twice, not a fuzzy match.
 */
export function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Classic edit distance, iterative with a single row. Inputs here are short names. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  const curr = new Array<number>(b.length + 1)

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    prev = curr.slice()
  }
  return prev[b.length]!
}

/** 1 = identical, 0 = nothing in common. Length-normalised so long names aren't punished. */
export function similarity(a: string, b: string): number {
  const na = normalise(a)
  const nb = normalise(b)
  if (na === nb) return 1
  const longest = Math.max(na.length, nb.length)
  if (longest === 0) return 1
  return 1 - editDistance(na, nb) / longest
}

/** Above this we pre-select the suggestion; below it the user picks from the list. */
export const SUGGEST_THRESHOLD = 0.85

export type Candidate = { id: string; name: string }

export type MatchResult =
  /** Same string once normalised — applied without asking. */
  | { kind: 'exact'; candidate: Candidate }
  /** Close enough to pre-select, but a human confirms it. */
  | { kind: 'suggestion'; candidate: Candidate; score: number }
  /** Nothing close. The review screen shows the full dropdown. */
  | { kind: 'none' }

/**
 * Resolve one distinct spreadsheet value against the candidates that exist.
 *
 * Note this runs per DISTINCT VALUE, not per row: 340 grant rows typically carry six
 * distinct programme strings, so one confirmation settles every row that shares it.
 */
export function matchValue(value: string, candidates: Candidate[]): MatchResult {
  const trimmed = value.trim()
  if (!trimmed) return { kind: 'none' }

  const target = normalise(trimmed)
  const exact = candidates.find((c) => normalise(c.name) === target)
  if (exact) return { kind: 'exact', candidate: exact }

  let best: Candidate | null = null
  let bestScore = 0
  for (const c of candidates) {
    const score = similarity(trimmed, c.name)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }

  if (best && bestScore >= SUGGEST_THRESHOLD) {
    return { kind: 'suggestion', candidate: best, score: bestScore }
  }
  return { kind: 'none' }
}

/**
 * Why we think two strings are the same thing, in words a foundation administrator
 * can act on. A bare score tells them nothing; "differs by case only" is instantly
 * checkable, which is what makes six confirmations take fifteen seconds.
 */
export function matchReason(value: string, candidateName: string): string {
  const a = value.trim()
  const b = candidateName
  if (a === b) return 'identical'
  if (a.toLowerCase() === b.toLowerCase()) return 'differs by capitalisation'
  if (a.trim() !== a || normalise(a) === normalise(b)) return 'differs by spacing or punctuation'

  const wordsA = normalise(a).split(' ').filter(Boolean).sort().join(' ')
  const wordsB = normalise(b).split(' ').filter(Boolean).sort().join(' ')
  if (wordsA === wordsB) return 'same words, different order'

  const distance = editDistance(normalise(a), normalise(b))
  if (distance === 1) return 'differs by one character'
  if (distance <= 3) return `differs by ${distance} characters`
  return 'closest match'
}

export type ValueResolution = {
  /** The distinct string as it appears in the file. */
  value: string
  /** How many rows carry it — shown so the user knows the weight of one decision. */
  rowCount: number
  match: MatchResult
  reason: string | null
}

/**
 * Group a column's values, resolve each distinct one, and report what needs a human.
 * Anything `exact` is settled; everything else lands on the review screen.
 */
export function resolveColumn(values: string[], candidates: Candidate[]): ValueResolution[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    const trimmed = (v ?? '').trim()
    if (!trimmed) continue
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([value, rowCount]) => {
      const match = matchValue(value, candidates)
      return {
        value,
        rowCount,
        match,
        reason: match.kind === 'suggestion' ? matchReason(value, match.candidate.name) : null,
      }
    })
    .sort((a, b) => b.rowCount - a.rowCount)
}
