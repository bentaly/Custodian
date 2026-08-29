// ─── Due diligence: does this number actually belong to the applicant? ──────
//
// Every other check asks whether the registered body is in good standing. This one
// asks the question that comes before it — whether the register entry we screened is
// the organisation that applied. One transposed digit lands on a real, healthy,
// entirely unrelated charity, and every downstream check then passes truthfully
// about somebody else: the application reads "Registered · 14 trustees · accounts up
// to date" and the screening is worthless. Nothing else we run can catch that,
// because from the register's point of view nothing is wrong.
//
// Deliberately its own module rather than a reuse of `lib/dataImport/match.ts`.
// That matcher is minimal on purpose — its own comments explain that it avoids
// token scoring because a dropdown always backstops a bad suggestion. Here nothing
// backstops it (this runs unattended at submission) and the failure runs the other
// way: raw edit distance scores `Arete Foundation` against `The Arete Foundation
// Limited` at 0.68, so an unfolded comparison would flag a mismatch on nearly every
// charitable company and teach admins to ignore the flag.
//
// A mismatch is a WARNING, never a block. Trading names, acronyms and pre-merger
// names all differ from the registered name legitimately. The check's job is to say
// "look at this", not to stop a grant.

/**
 * Legal forms carry no identity — `Ltd`, `CIC`, `CIO` tell you how a body is
 * constituted, not which body it is. Stripped from both sides before comparing.
 *
 * Words like `trust`, `foundation`, `charity`, `association` and `society` are
 * deliberately NOT here. They look like noise and are not: "Smith Trust" and "Smith
 * Foundation" are different organisations, and folding them together would turn a
 * genuine mismatch into a pass — the one outcome this check exists to prevent.
 */
const LEGAL_FORM_TOKENS = new Set([
  'ltd',
  'limited',
  'plc',
  'llp',
  'lp',
  'cic',
  'cio',
  'scio',
  'inc',
  'incorporated',
  'unincorporated',
  'the',
])

/** Multi-word legal forms, removed before tokenising so their words don't survive. */
const LEGAL_FORM_PHRASES = [
  'charitable incorporated organisation',
  'scottish charitable incorporated organisation',
  'community interest company',
  'company limited by guarantee',
  'limited by guarantee',
  'registered charity',
]

/** Fold away everything that is punctuation, case, accent or spacing. */
function fold(value: string): string {
  return (
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      // Apostrophes CLOSE rather than split: charity names are full of them
      // ("Barnardo's", "St John's", "Children's Society"), and splitting turns one
      // token into two, which then fails token comparison against the same name
      // typed without one.
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  )
}

/** Fold, drop legal forms, and return the identity-carrying tokens. */
export function nameTokens(value: string): string[] {
  let folded = fold(value)
  for (const phrase of LEGAL_FORM_PHRASES) {
    folded = folded.split(phrase).join(' ')
  }
  return folded.split(' ').filter((t) => t && !LEGAL_FORM_TOKENS.has(t))
}

/** The comparable form of a name: identity tokens, in order, space-joined. */
export function normaliseOrgName(value: string): string {
  return nameTokens(value).join(' ')
}

/** Classic edit distance, single-row. Names are short. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

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

/** 1 = identical, 0 = nothing in common. Length-normalised. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const longest = Math.max(a.length, b.length)
  if (longest === 0) return 1
  return 1 - editDistance(a, b) / longest
}

/**
 * Typos and house-style differences live above this; different organisations live
 * below it. Applied to the FOLDED strings, so the legal-form and punctuation cases
 * have already been dealt with and this only has to absorb genuine misspelling.
 */
export const NAME_MATCH_THRESHOLD = 0.85

/** Initials of the identity tokens — `nspcc` for "National Society for …". */
function initials(tokens: string[]): string {
  return tokens.map((t) => t[0]).join('')
}

export interface NameComparison {
  match: boolean
  /** Why, in words an administrator can check at a glance. */
  reason: string
  score: number
}

/**
 * Compare the name the applicant gave against a name on the register.
 *
 * The ordering is from most to least certain, and every passing rule is one a human
 * would accept without argument — same words, one contains the other, an acronym, or
 * a near-miss spelling. Anything else is reported for a person to look at.
 */
export function compareOrgNames(applicant: string, registered: string): NameComparison {
  const aTokens = nameTokens(applicant)
  const bTokens = nameTokens(registered)
  const a = aTokens.join(' ')
  const b = bTokens.join(' ')

  // Nothing identity-carrying left on one side (e.g. the applicant typed "The Trust
  // Ltd"). Can't judge it — say so rather than guessing either way.
  if (!a || !b) return { match: false, reason: 'no comparable name', score: 0 }

  if (a === b) return { match: true, reason: 'identical', score: 1 }

  const aSet = [...aTokens].sort().join(' ')
  const bSet = [...bTokens].sort().join(' ')
  if (aSet === bSet) return { match: true, reason: 'same words in a different order', score: 1 }

  // One name contains the other in full — "Arete Foundation" vs "Arete Foundation
  // for Community Action". The shorter is a working name of the longer far more
  // often than it is a different body.
  const [shorter, longer] =
    aTokens.length <= bTokens.length ? [aTokens, bTokens] : [bTokens, aTokens]
  if (shorter.every((t) => longer.includes(t))) {
    return { match: true, reason: 'one name contains the other in full', score: 0.95 }
  }

  // Acronym on either side.
  if (aTokens.length === 1 && aTokens[0] === initials(bTokens)) {
    return {
      match: true,
      reason: 'applicant name is an acronym of the registered name',
      score: 0.9,
    }
  }
  if (bTokens.length === 1 && bTokens[0] === initials(aTokens)) {
    return {
      match: true,
      reason: 'registered name is an acronym of the applicant name',
      score: 0.9,
    }
  }

  const score = similarity(a, b)
  if (score >= NAME_MATCH_THRESHOLD) {
    const distance = editDistance(a, b)
    return {
      match: true,
      reason: distance === 1 ? 'differs by one character' : `differs by ${distance} characters`,
      score,
    }
  }

  return { match: false, reason: 'different name', score }
}

export interface BestNameMatch extends NameComparison {
  /** Which of the candidate names produced this result. */
  matched: string
  /** True when the winning name was a former name rather than the current one. */
  viaPreviousName: boolean
}

/**
 * Compare against the current registered name and any former names.
 *
 * Former names matter because a body that renamed last year is still on the
 * applicant's letterhead under the old one — and Companies House hands us
 * `previous_company_names` in the profile we already fetch, so it costs nothing.
 */
export function bestNameMatch(applicant: string, candidates: string[]): BestNameMatch | null {
  const names = candidates.map((n) => n?.trim()).filter((n): n is string => !!n)
  if (!applicant.trim() || names.length === 0) return null

  let best: BestNameMatch | null = null
  for (const [index, name] of names.entries()) {
    const result = compareOrgNames(applicant, name)
    const candidate: BestNameMatch = { ...result, matched: name, viaPreviousName: index > 0 }
    if (!best || candidate.score > best.score) best = candidate
    if (best.match && best.score === 1) break
  }
  return best
}
