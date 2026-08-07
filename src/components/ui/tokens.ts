// The Figma variables, in one place.
//
// Until the design token set lands, every screen has been re-declaring its own `C`
// object of hex codes — which is how the app ended up with two button vocabularies and
// a date pill in the wrong grey. Shared components import from here; a screen that
// still has a local `C` should be migrated to it rather than extended.
//
// Greys are Figma's Gray/N scale. `brand` is the one green, with its 10%/20% washes for
// tinted surfaces and its 5% for hovers.

export const C = {
  ink: '#141C24', // Gray/900 — all body text, every icon, every dropdown caret
  body: '#344051', // Gray/700
  sub: '#637083', // Gray/500 — secondary text, placeholders
  faint: '#97A1AF', // Gray/400 — meta, disabled
  muted: '#CED2DA', // Gray/300
  line: '#E4E7EC', // Gray/200 — every border
  wash: '#F2F4F7', // Gray/100 — filled inputs, avatar tiles
  white: '#FFFFFF',

  brand: '#1F7A5C',
  brandHover: '#17563F',
  brandBg: 'rgba(31, 122, 92, 0.1)',
  brandBorder: 'rgba(31, 122, 92, 0.2)',
  brandWash: '#EDF6F2',

  success: '#31A650',
  amber: '#9B6916',
  amberWash: '#FEF7EB',
  danger: '#FF4242',
  dangerWash: '#FDEFF2',
  warning: '#F89828',
  info: '#3B82C4',
} as const

// Two values were in circulation for each of `danger` and `faint` when this file was
// written. The ones above are the pair the Figma-correct screens use (dashboard,
// applications, insights); `#C0344F` and `#98A2B3` were the strays, on Shortlist/VoteCard
// and the dashboard respectively. Change the red here if the deeper one is preferred —
// that is the point of it being in one place.

/**
 * The two control heights the design uses, and the radius each one wears: 32px
 * controls are 8px-rounded (filter chips, in-card actions), 40px controls are
 * 12px-rounded (screen-level buttons, the search field, the round pill).
 */
export const CONTROL = {
  sm: { height: 'h-8', radius: 'rounded-lg', text: 'text-[14px]', padding: 'px-3' },
  md: { height: 'h-10', radius: 'rounded-[12px]', text: 'text-[14px]', padding: 'px-4' },
} as const

export type ControlSize = keyof typeof CONTROL
