import type { ReactNode } from 'react'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { withAlpha } from '../BarMeter'

// The small sibling of the dashboard's KPI card (Figma 112:134): a white card with a
// tinted inner panel — big number, supporting line, icon + label footer. Used as the
// stat row above a list screen. Lifted out of Insights / the application detail, which
// each had their own copy.

const C = {
  ink: '#141C24',
  sub: '#637083',
  line: '#E4E7EC',
}

/** The four pastel tints, in the order they read across a stat row. */
export const KPI_TINTS = {
  violet: { bg: '#F5F4FF', accent: '#8B7FF0' },
  green: { bg: '#EDF9F1', accent: '#31A650' },
  amber: { bg: '#FEF7EB', accent: '#F89828' },
  pink: { bg: '#FDEFF2', accent: '#F0537A' },
} as const

export type KpiTint = { bg: string; accent: string }

/**
 * The number's type scale, straight from Figma (node 112:739 — Inter Display Medium,
 * Gray/900): `lg` is the 32px headline used on the dashboard and Insights; `sm` is the
 * 16px figure every other screen's stat cards use.
 */
const VALUE_SIZE = {
  lg: 'font-display text-[32px] font-medium leading-none',
  sm: 'font-display text-[16px] font-medium leading-snug',
} as const

export function MiniKpi({
  tint,
  icon,
  label,
  value,
  sub,
  size = 'sm',
  valueClass,
  valueColor,
  subColor,
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
  valueColor?: string
  subColor?: string
  /** Extra content inside the tinted panel — a meter, chips, a progress bar. */
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col rounded-[20px] border bg-white p-1" style={{ borderColor: C.line }}>
      <div className="relative overflow-hidden rounded-2xl p-4" style={{ backgroundColor: tint.bg }}>
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
          <div
            className={`truncate ${valueClass ?? VALUE_SIZE[size]}`}
            style={{ color: valueColor ?? C.ink }}
            title={typeof value === 'string' ? value : undefined}
          >
            {value}
          </div>
          <div className="mt-1.5 truncate text-xs font-medium" style={{ color: subColor ?? C.sub }}>
            {sub}
          </div>
          {children}
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <HugeiconsIcon icon={icon} className="h-4 w-4" strokeWidth={1.6} style={{ color: C.sub }} />
        <span className="text-[13px] font-medium" style={{ color: C.ink }}>
          {label}
        </span>
      </div>
    </div>
  )
}
