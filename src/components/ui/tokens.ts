// The Figma colour variables, for the places a Tailwind class cannot reach: inline
// `style` objects, Recharts props, SVG attributes. Everything else should use the
// utility (`text-gray-500`), not `C.sub` — same token either way.
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
  ink: 'var(--color-gray-900)', // body text, icons, dropdown carets
  body: 'var(--color-gray-700)',
  sub: 'var(--color-gray-500)', // secondary text, placeholders
  faint: 'var(--color-gray-400)', // meta, disabled
  muted: 'var(--color-gray-300)',
  line: 'var(--color-gray-200)', // every border
  wash: 'var(--color-gray-100)', // filled inputs, avatar tiles
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

// The four semantic hues are FILL colours: none reaches 4.5:1 as text on white or on its
// own 10% wash, so status pills built from them fail WCAG AA. This is deliberate as of
// 2026-08-10 — the Figma values are used as-is rather than inventing darker foregrounds,
// and the designer has been asked for an accessible text variant of each. When those
// arrive they belong in `globals.css` as `--color-*-fg`, not as literals here.

/** The colours a foundation picks a programme's colour from — the Figma Accent family
 *  plus Semantic/Success, exactly the five bound on the Programmes comp (674:33847). */
export const PROGRAMME_COLORS = [
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
