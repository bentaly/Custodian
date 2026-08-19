// Programme-level impact measurement units ("Impact measured in…").
//
// Each programme declares the countable unit its grants' impact is reported in.
// The label is a PLURAL noun phrase used verbatim in two places:
//   1. display — Insights stat cards and per-programme impact rows ("1,240 people")
//   2. AI extraction — when a grant report is analysed, the prompt asks how many
//      {label} the report evidences
// We deliberately collect/store the plural form and never inflect it in code.
// 'other' lets the client type their own phrase (programmes.impactUnitLabel),
// e.g. "hectares of peatland restored" — the more specific, the better the
// extraction.

export interface ImpactUnit {
  key: string
  /** Plural display label, e.g. "People". */
  label: string
  /** Singular, for a RATE — "£175 per person". Stated, not derived: the plural of the
   *  one unit every foundation uses is irregular, so stripping an `s` gave "per people". */
  singular: string
  /** Short qualifier shown next to the selector, e.g. "People reached". */
  hint: string
}

export const IMPACT_UNITS: ImpactUnit[] = [
  { key: 'people', label: 'People', singular: 'Person', hint: 'People reached' },
  { key: 'households', label: 'Households', singular: 'Household', hint: 'Households supported' },
  { key: 'animals', label: 'Animals', singular: 'Animal', hint: 'Animals helped' },
  { key: 'hectares', label: 'Hectares', singular: 'Hectare', hint: 'Land restored or protected' },
  { key: 'trees', label: 'Trees', singular: 'Tree', hint: 'Trees planted' },
  {
    key: 'tonnes_co2e',
    label: 'Tonnes CO₂e',
    singular: 'Tonne CO₂e',
    hint: 'Emissions avoided or removed',
  },
  {
    key: 'items',
    label: 'Items delivered',
    singular: 'Item delivered',
    hint: 'e.g. meals, parcels, laptops',
  },
  { key: 'other', label: 'Other…', singular: 'Other…', hint: 'Define your own unit' },
]

export const DEFAULT_IMPACT_UNIT = 'people'

export const IMPACT_UNIT_KEYS = IMPACT_UNITS.map((u) => u.key)

export const IMPACT_UNIT_BY_KEY: Record<string, ImpactUnit> = Object.fromEntries(
  IMPACT_UNITS.map((u) => [u.key, u]),
)

/**
 * The display/extraction label for a programme's unit: the free-text phrase for
 * 'other' (falling back to the default unit if blank), else the curated label.
 */
export function impactUnitLabel(
  unit: string | null | undefined,
  customLabel?: string | null,
): string {
  if (unit === 'other' && customLabel?.trim()) return customLabel.trim()
  const known = unit ? IMPACT_UNIT_BY_KEY[unit] : undefined
  if (known && known.key !== 'other') return known.label
  return IMPACT_UNIT_BY_KEY[DEFAULT_IMPACT_UNIT]!.label
}

// ─── Singulars ───────────────────────────────────────────────────────────────────
//
// The rule above — collect the plural, never inflect — holds everywhere a COUNT is
// shown ("1,240 people") and in the AI prompt. A RATE is the one place it breaks:
// "£175 per people" is wrong however many people there are, and the naive fix (strip a
// trailing `s`) leaves it wrong for exactly the unit every foundation starts on.
//
// So the curated units STATE their singular, and only the free-text 'other' phrase is
// inflected — where there is nothing else to go on. That inflection changes exactly one
// word: the rightmost one that looks plural. English puts the number on the head noun,
// and the head is the last noun before any tail — "bus routes" (compound, last word)
// and "hectares of peatland restored" (tail, first word) both fall out of the same
// right-to-left scan. A phrase with no plural-looking word comes back unchanged, which
// is no worse than not asking.

const IRREGULAR_SINGULARS: Record<string, string> = {
  people: 'person',
  children: 'child',
  women: 'woman',
  men: 'man',
}

// `-us`, `-is` and `-ss` are excluded from the plain `-s` rule: they are almost never a
// plural marker, and without them "bus stops" became "bu stops" and "analysis" "analysi".
const PLURAL_ES = /(ses|xes|zes|ches|shes)$/i
const PLURAL_IES = /[^aeiou]ies$/i
const PLURAL_S = /[^suis]s$/i

function looksPlural(word: string): boolean {
  const lower = word.toLowerCase()
  return (
    lower in IRREGULAR_SINGULARS ||
    PLURAL_IES.test(word) ||
    PLURAL_ES.test(word) ||
    PLURAL_S.test(word)
  )
}

/** Singularise one word already known to look plural. */
function singulariseWord(word: string): string {
  const irregular = IRREGULAR_SINGULARS[word.toLowerCase()]
  if (irregular) return matchCase(word, irregular)
  if (PLURAL_IES.test(word)) return word.slice(0, -3) + matchCase(word, 'y')
  if (PLURAL_ES.test(word)) return word.slice(0, -2)
  return word.slice(0, -1)
}

/** Keep the replacement in the case the original was written in. */
function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase()) return replacement.toUpperCase()
  if (original[0] === original[0]?.toUpperCase()) {
    return replacement[0]!.toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/**
 * The unit as it reads in a rate: `£{amount} per {impactUnitSingular(...)}`. Curated
 * units answer from their own `singular`; a custom phrase has its head noun inflected
 * and everything else left exactly as the foundation typed it.
 */
export function impactUnitSingular(
  unit: string | null | undefined,
  customLabel?: string | null,
): string {
  if (unit === 'other' && customLabel?.trim()) {
    const words = customLabel.trim().split(/\s+/)
    for (let i = words.length - 1; i >= 0; i--) {
      if (looksPlural(words[i]!)) {
        words[i] = singulariseWord(words[i]!)
        break
      }
    }
    return words.join(' ')
  }
  const known = unit ? IMPACT_UNIT_BY_KEY[unit] : undefined
  if (known && known.key !== 'other') return known.singular
  return IMPACT_UNIT_BY_KEY[DEFAULT_IMPACT_UNIT]!.singular
}
