/**
 * The AI-score filter's bands — **the same three bands the score is coloured in**.
 *
 * The filter used to offer 90+ / 80–89 / 70–79 / Below 70: four round numbers that
 * matched nothing else in the app. A reviewer filtering "70–79" got a band of rows that
 * were all green, and "Below 70" mixed the amber half of the scale in with the red — so
 * the control you narrow a list with and the colour you read a row by disagreed about
 * where the lines are. The RAG bands are the ones a foundation has actually been taught
 * (`bandForScore`, `components/ui/tokens.ts`), so they are the ones the filter offers:
 * pick "70+" and you get exactly the green rows.
 *
 * `bandForScore` bands as a PROPORTION of the scale, because the composite is out of 100
 * and a criterion out of 10 — `scoreBandKey` below is that rule, and `SCORE_BANDS` is
 * the same thresholds written out against the 0–100 composite, which is the only scale
 * anything is filtered on. Move a threshold here and the colour moves with it.
 *
 * `min`/`max` are INCLUSIVE and integral, which `applications.custodian_score` is.
 */

export const SCORE_BANDS = [
  { value: 'good', label: '70+', min: 70, max: 100 },
  { value: 'fair', label: '40–69', min: 40, max: 69 },
  { value: 'poor', label: 'Below 40', min: 0, max: 39 },
] as const

export type ScoreBandKey = (typeof SCORE_BANDS)[number]['value']

/** The band values, for the zod enum and the search parser. */
export const SCORE_BAND_VALUES = SCORE_BANDS.map((b) => b.value) as unknown as [
  ScoreBandKey,
  ...ScoreBandKey[],
]

/** `{ value, label }` for `FilterPill`. */
export const SCORE_BAND_OPTIONS: Array<{ value: ScoreBandKey; label: string }> = SCORE_BANDS.map(
  (b) => ({ value: b.value, label: b.label }),
)

export function scoreBandFor(value: string | undefined) {
  return SCORE_BANDS.find((b) => b.value === value)
}

/**
 * Which band a score falls in, normalised against the scale it is quoted on: 70% and up
 * is good, 40% and up is fair, below that is poor. `components/ui/tokens.ts` turns the
 * key into colours; nothing else should re-state the numbers.
 */
export function scoreBandKey(score: number, outOf: 100 | 10 = 100): ScoreBandKey {
  const pct = (score / outOf) * 100
  return pct >= 70 ? 'good' : pct >= 40 ? 'fair' : 'poor'
}
