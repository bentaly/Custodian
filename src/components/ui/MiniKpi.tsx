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

export function MiniKpi({
  tint,
  icon,
  label,
  value,
  sub,
  valueClass = 'text-[30px] font-semibold leading-none',
  valueColor,
  subColor,
  children,
}: {
  tint: KpiTint
  icon: IconSvgElement
  label: string
  value: ReactNode
  sub: ReactNode
  /** Override the number's type scale (e.g. 24px where the value is a long string). */
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
          className="pointer-events-none absolute right-0 top-0 z-0 aspect-square w-1/2 -translate-y-[17%]"
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
            className={`truncate ${valueClass}`}
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
