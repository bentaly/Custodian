import type { ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { withAlpha } from '../BarMeter'
import { C } from './tokens'
import { TruncatedText } from './TruncatedText'

// The small sibling of the dashboard's KPI card (Figma 112:134): a white card with a
// tinted inner panel — big number, supporting line, icon + label footer. Used as the
// stat row above a list screen. Lifted out of Insights / the application detail, which
// each had their own copy.

/**
 * The pastel tints, in the order they read across a stat row — the five fills sampled
 * off the Figma stat row (435:38511): #F1F1FC, #E7F2EA, #FEF9F0, #FEF5F9, #EBFAFE.
 *
 * Four of the five are the **Accent** family, not the semantic hues, and that is the
 * whole point of this list. `amber` and `pink` used to be `--color-warning` and
 * `--color-danger`; since those were darkened to clear 4.5:1 as TEXT (see `tokens.ts`),
 * warning at 10% is a dull tan and danger at 10% a grey-pink — neither is the cream and
 * blush the comps draw. Same split as `SCORE_BAND`: accents fill, semantics label.
 *
 * A tint here carries no meaning. It is the card's place in the row, which is why the
 * keys are colours rather than states — nothing should read "pink" as "bad".
 */
export const KPI_TINTS = {
  violet: {
    bg: 'color-mix(in srgb, var(--color-accent-violet) 10%, transparent)',
    accent: 'var(--color-accent-violet)',
  },
  green: {
    bg: 'color-mix(in srgb, var(--color-success) 10%, transparent)',
    accent: 'var(--color-success)',
  },
  amber: {
    bg: 'color-mix(in srgb, var(--color-accent-amber) 10%, transparent)',
    accent: 'var(--color-accent-amber)',
  },
  pink: {
    bg: 'color-mix(in srgb, var(--color-accent-blush) 10%, transparent)',
    accent: 'var(--color-accent-blush)',
  },
  sky: {
    bg: 'color-mix(in srgb, var(--color-accent-sky) 10%, transparent)',
    accent: 'var(--color-accent-sky)',
  },
} as const

export type KpiTint = { bg: string; accent: string }

/**
 * The number's type scale, straight from Figma (node 112:739 — Inter Display Medium,
 * Gray/900): `lg` is the 32px headline used on the dashboard and Insights; `sm` is the
 * 16px figure every other screen's stat cards use.
 */
const VALUE_SIZE = {
  lg: 'font-display text-display font-medium leading-none',
  sm: 'font-display text-title font-medium leading-snug',
} as const

/**
 * The rest of the card's metrics follow the number's scale. `lg` is measured off
 * the Figma card (128:39856): 24/12 padding inside the tinted panel, a 14px
 * supporting line, and a 14px footer beside a 20px icon. `sm` keeps the tighter
 * scale the list screens' stat rows were built at.
 */
const SCALE = {
  lg: {
    panel: 'px-3 py-6',
    sub: 'text-body',
    footer: 'px-3 py-3',
    label: 'text-body',
    icon: 20,
  },
  sm: { panel: 'p-4', sub: 'text-label', footer: 'px-4 py-3', label: 'text-body', icon: 16 },
} as const

export function MiniKpi({
  tint,
  icon,
  label,
  value,
  sub,
  size = 'sm',
  valueClass,
  valueColour,
  subColour,
  children,
}: {
  tint: KpiTint
  icon: IconSvgElement
  label: string
  value: ReactNode
  sub: ReactNode
  /** `lg` (32px) for the dashboard/Insights headline row; `sm` (16px) everywhere else. */
  size?: keyof typeof VALUE_SIZE
  /** Escape hatch for a one-off type scale; overrides `size`. */
  valueClass?: string
  /** Colour the number when it carries a warning (e.g. money overdue). */
  valueColour?: string
  subColour?: string
  /** Extra content inside the tinted panel — a meter, chips, a progress bar. */
  children?: ReactNode
}) {
  const scale = SCALE[size]
  return (
    <div className="flex flex-col rounded-pill border bg-white p-1" style={{ borderColor: C.line }}>
      <div
        className={`relative overflow-hidden rounded-card ${scale.panel}`}
        style={{ backgroundColor: tint.bg }}
      >
        {/* Figma "Mask group" (112:802): a radial accent gradient shown *through* a dot
            grid — the gradient is the fill, the dots are the mask. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 z-0 aspect-square w-1/2 translate-y-[-17%]"
          style={{
            backgroundImage: `radial-gradient(50% 50% at 50% 50%, ${withAlpha(tint.accent, 0.5)} 0%, ${withAlpha(tint.accent, 0)} 100%)`,
            WebkitMaskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            maskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            WebkitMaskSize: '7px 7px',
            maskSize: '7px 7px',
          }}
        />
        <div className="relative z-10">
          {/* A long figure ("£1,284,500 of £2m") is clipped by the card, so the whole
              of it is handed over on hover AND on focus — `TruncatedText` wires that
              only when the string is actually cut off, so cards that fit stay silent. */}
          <div style={{ color: valueColour ?? C.ink }}>
            {typeof value === 'string' ? (
              <TruncatedText
                text={value}
                label={label}
                className={valueClass ?? VALUE_SIZE[size]}
              />
            ) : (
              <div className={`truncate ${valueClass ?? VALUE_SIZE[size]}`}>{value}</div>
            )}
          </div>
          <div
            className={`mt-1 truncate font-medium ${scale.sub}`}
            style={{ color: subColour ?? C.sub }}
          >
            {sub}
          </div>
          {children}
        </div>
      </div>
      <div className={`flex items-center gap-2 ${scale.footer}`}>
        <HugeiconsIcon icon={icon} size={scale.icon} strokeWidth={1.6} style={{ color: C.sub }} />
        <span className={`font-medium ${scale.label}`} style={{ color: C.ink }}>
          {label}
        </span>
      </div>
    </div>
  )
}
