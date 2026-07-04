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
  /** Short qualifier shown next to the selector, e.g. "People reached". */
  hint: string
}

export const IMPACT_UNITS: ImpactUnit[] = [
  { key: 'people', label: 'People', hint: 'People reached' },
  { key: 'households', label: 'Households', hint: 'Households supported' },
  { key: 'animals', label: 'Animals', hint: 'Animals helped' },
  { key: 'hectares', label: 'Hectares', hint: 'Land restored or protected' },
  { key: 'trees', label: 'Trees', hint: 'Trees planted' },
  { key: 'tonnes_co2e', label: 'Tonnes CO₂e', hint: 'Emissions avoided or removed' },
  { key: 'items', label: 'Items delivered', hint: 'e.g. meals, parcels, laptops' },
  { key: 'other', label: 'Other…', hint: 'Define your own unit' },
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
export function impactUnitLabel(unit: string | null | undefined, customLabel?: string | null): string {
  if (unit === 'other' && customLabel?.trim()) return customLabel.trim()
  const known = unit ? IMPACT_UNIT_BY_KEY[unit] : undefined
  if (known && known.key !== 'other') return known.label
  return IMPACT_UNIT_BY_KEY[DEFAULT_IMPACT_UNIT]!.label
}
