/**
 * The name an application gets when the submission did not say who it is from.
 *
 * `applications.organisation_name` stays NOT NULL on purpose: every list, search, letter
 * and export reads it, and a nullable name would put a blank row in each of them. So a
 * submission without one lands under a stand-in built from the foundation's own
 * reference (which is still required, so there is always one), and the application
 * lists "Organisation name" among what was not captured, with a way to fill it in.
 *
 * The stand-in is recognised by its SHAPE, which is why it is built and recognised in
 * one place: reading it as a real name would tell the gaps panel nothing is missing.
 */
const PREFIX = 'Unnamed (ref '

export function unnamedOrganisation(reference: string | null | undefined): string {
  return `${PREFIX}${reference?.trim() || 'unknown'})`
}

export function isUnnamedOrganisation(name: string | null | undefined): boolean {
  return !!name && name.startsWith(PREFIX) && name.endsWith(')')
}

/** Kept in capitals when a register name is tidied: they are initials, not words. */
const KEEP_CAPS = new Set([
  'UK',
  'CIC',
  'CIO',
  'NHS',
  'YMCA',
  'YWCA',
  'RNLI',
  'NSPCC',
  'RSPCA',
  'RSPB',
  'RNIB',
  'CVS',
  'PCC',
  'PTA',
  'PTFA',
  'SEN',
  'SEND',
  'LGBT',
  'LGBTQ',
  'BME',
  'BAME',
  'II',
  'III',
])
const LOWER = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'at', 'to', 'a', 'an', 'with'])

/**
 * A registered name as it should read on screen. The Charity Commission holds names in
 * capitals ("THE HARBOUR LIGHTS YOUTH TRUST"), which would shout from every list; a name
 * already in mixed case is taken as somebody's deliberate spelling and left alone.
 */
export function tidyRegisteredName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (trimmed !== trimmed.toUpperCase()) return trimmed
  return trimmed
    .split(' ')
    .map((word, i) => {
      const bare = word.replace(/[^A-Z]/g, '')
      if (KEEP_CAPS.has(bare)) return word
      const lower = word.toLowerCase()
      if (i > 0 && LOWER.has(lower)) return lower
      // Each part of a hyphenated word on its own: "STOCKTON-ON-TEES" -> "Stockton-on-Tees".
      return lower
        .split('-')
        .map((part, j) =>
          j > 0 && LOWER.has(part)
            ? part
            : part.replace(
                /(^|[(/])([a-z])/g,
                (_, sep: string, ch: string) => sep + ch.toUpperCase(),
              ),
        )
        .join('-')
    })
    .join(' ')
}
