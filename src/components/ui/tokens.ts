// The Figma colour variables, for the places a Tailwind class cannot reach: inline
// `style` objects, Recharts props, SVG attributes. Everything else should use the
// utility (`text-grey-500`), not `C.sub` — same token either way.
//
// No hex codes live here any more. Each entry points at the custom property defined in
// `styles/globals.css`, which is the single transcription of the Figma variables; a
// token changed there changes here, and there is no second copy to drift.
//
// Tints follow the ladder the comps use — brand at 5% for a surface, 10% for a fill,
// 20% for a border (nodes 222:1026, 217:664) — expressed with `color-mix` so they
// derive from the token rather than being separate frozen values.

/** A token at a percentage of itself — the tint ladder, as ALPHA rather than a
 *  composite over white, which is what the comps use (`rgba(31,122,92,0.1)`). The
 *  difference shows the moment a tinted thing sits on anything but a white surface. */
export const tint = (token: string, pct: number) =>
  `color-mix(in srgb, var(--color-${token}) ${pct}%, transparent)`

export const C = {
  ink: 'var(--color-grey-900)', // body text, icons, dropdown carets
  body: 'var(--color-grey-700)',
  sub: 'var(--color-grey-500)', // secondary text, placeholders
  faint: 'var(--color-grey-400)', // meta, disabled
  muted: 'var(--color-grey-300)',
  line: 'var(--color-grey-200)', // every border
  wash: 'var(--color-grey-100)', // filled inputs, avatar tiles
  white: 'var(--color-white)',

  brand: 'var(--color-brand)',
  brandWash: tint('brand', 5), // a surface carrying brand meaning
  brandBg: tint('brand', 10), // a filled chip or tinted button
  brandBorder: tint('brand', 20),
  /** Brand/Secondary — a SOLID pale green the designer picked, not a step on the tint
   *  ladder above. It is what a selected-but-not-current thing wears (the calendar's
   *  in-range days, the sidebar's active item); brand at 5% alpha is far too faint to
   *  read as selected, which is why this is its own token rather than `brandWash`. */
  brandSecondary: 'var(--color-brand-secondary)',

  success: 'var(--color-success)',
  successWash: tint('success', 10),
  warning: 'var(--color-warning)',
  warningWash: tint('warning', 10),
  danger: 'var(--color-danger)',
  dangerWash: tint('danger', 10),
  info: 'var(--color-info)',
  infoWash: tint('info', 10),

  /** Alias kept because a dozen call sites say `amber` for the warning hue. */
  amber: 'var(--color-warning)',
  amberWash: tint('warning', 10),
} as const

// The four semantic hues were darkened wholesale on 2026-08-12 (see `globals.css`) so
// they clear 4.5:1 as TEXT. That is what `C.success` / `C.warning` / `C.danger` are for
// now — foregrounds first, fills second. Warning in particular went to `#ab5c00`, which
// reads as amber at 14px and as a brown barely distinguishable from danger in a 3px
// meter. See `SCORE_BAND` below for the fill-side answer.

// ─── Score bands ────────────────────────────────────────────────────────────────

/**
 * The RAG banding behind every AI score in the app, in ONE place: the applications list,
 * the application screen's ring, the shortlist's vote card and the Set up awards queue
 * each used to carry their own copy, and they had drifted — the detail screen banded at
 * 75/50 where the list banded at 80/60, so a 76 was green on one screen and amber on the
 * screen it opened. `bandForScore` below is the single rule they now all read.
 *
 * Each band carries TWO colours, because a band has to survive at two sizes:
 *
 *   • `fill` — a 3px meter, a ring arc, a tile tint. Amber here is `--color-accent-amber`,
 *     the Figma accent the dashboard's Finance meter is already drawn in. `--color-warning`
 *     cannot do this job: at #ab5c00 a 40px-wide bar is brown, and a 71 was being read off
 *     the applications list as a failing score.
 *   • `text` — the figure beside the meter. Here amber IS `--color-warning`, which is the
 *     value that clears contrast; the accent would be invisible on white.
 */
export const SCORE_BAND = {
  good: { fill: C.success, text: C.success },
  fair: { fill: 'var(--color-accent-amber)', text: C.warning },
  poor: { fill: C.danger, text: C.danger },
} as const

/**
 * Which band a score falls in — **one rule, expressed as a proportion of the scale**:
 * 70% and up is good, 40% and up is fair, below that is poor.
 *
 * `outOf` is the scale the figure is quoted on & is used only to NORMALISE it. The two
 * scales are deliberate — the composite is out of 100, a single criterion out of 10, and
 * a composite is never quoted as `7.1/10` — but the colour is a judgement about the
 * proportion, and it has to mean the same thing on both. It did not: the thresholds used
 * to be 80/60 out of 100 against 7/4 out of 10, so 70% was AMBER as a composite and
 * GREEN as a criterion, on screens that sit next to each other.
 *
 * Aligning them moves the composite's boundaries, not the criteria's: green now starts
 * at 70 rather than 80, and amber at 40 rather than 60.
 */
export function bandForScore(score: number, outOf: 100 | 10 = 100) {
  const pct = (score / outOf) * 100
  return SCORE_BAND[pct >= 70 ? 'good' : pct >= 40 ? 'fair' : 'poor']
}

/**
 * The RAG band an IMD decile falls in — the 3-4-3 split of the ten: **1–3 red, 4–7
 * amber, 8–10 green**.
 *
 * Read it as a scale of DEPRIVATION, not of performance. Red is the most deprived
 * tenth of areas in its nation, which for most foundations is where the money is meant
 * to go — a portfolio weighted red is the good outcome, and the panel's legend says so
 * in words rather than leaving the colour to argue it. The point of banding at all is
 * that a decile is an ordered scale, and two flat colours ("1–4" against "the rest")
 * threw away the ordering between 1 and 4, and between 5 and 10.
 *
 * It reuses `SCORE_BAND`'s fills so the app has one red, one amber and one green in
 * chart-fill weight; only the direction is reversed. The "Deprivation reach" KPI still
 * counts deciles 1–4 — that is a defined measure (the most deprived 40%), not a colour
 * band, so it is deliberately not 3-4-3.
 */
export function bandForDecile(decile: number) {
  return SCORE_BAND[decile <= 3 ? 'poor' : decile <= 7 ? 'fair' : 'good']
}

/** The colours a foundation picks a programme's colour from — the Figma Accent family
 *  plus Semantic/Success, exactly the five bound on the Programmes comp (674:33847). */
export const PROGRAMME_COLOURS = [
  'var(--color-accent-sky)',
  'var(--color-success)',
  'var(--color-accent-blush)',
  'var(--color-accent-amber)',
  'var(--color-accent-violet)',
] as const

/**
 * The two control heights the design uses, and the radius each one wears: 32px
 * controls are 8px-rounded (filter chips, in-card actions), 40px controls are
 * 12px-rounded (screen-level buttons, the search field, the round pill).
 */
export const CONTROL = {
  sm: { height: 'h-8', radius: 'rounded-chip', text: 'text-body', padding: 'px-3' },
  md: { height: 'h-10', radius: 'rounded-control', text: 'text-body', padding: 'px-4' },
} as const

export type ControlSize = keyof typeof CONTROL
