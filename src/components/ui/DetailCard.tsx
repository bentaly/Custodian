import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import { C } from './tokens'

// The side-column furniture the grant's two screens share — the report screen's grant
// cards and the award screen's. Lifted out of the report screen when the award screen was
// redrawn to the same design (Figma 1347:540), so a grant's details read the same whether
// you reached them from its report or from the grant itself.

/** A card's title row: the title, and a quiet slot on the right. */
export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right && (
        <span
          className="shrink-0 whitespace-nowrap font-display text-body"
          style={{ color: C.sub }}
        >
          {right}
        </span>
      )}
    </div>
  )
}

/** One fact about the grant: a quiet label, and the value set right. The value wraps
 *  rather than truncating — a programme name is read, not scanned. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 whitespace-nowrap font-display text-body" style={{ color: C.sub }}>
        {label}
      </dt>
      <dd
        className="min-w-0 break-words text-right font-display text-body font-medium"
        style={{ color: C.ink }}
      >
        {children}
      </dd>
    </div>
  )
}

/** The small grey dot a `·` becomes between two facts on one line. */
export function Dot() {
  return (
    <span
      aria-hidden
      className="mx-2 inline-block size-[3px] shrink-0 rounded-full align-middle"
      style={{ backgroundColor: C.faint }}
    />
  )
}

export function ThemePill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-pill px-2 py-0.5 font-display text-label font-medium"
      style={{ backgroundColor: C.wash, color: C.sub }}
    >
      {children}
    </span>
  )
}

/** How many theme pills show before the rest fold into a "+n". */
const THEMES_SHOWN = 2

/** A programme's themes as pills, the tail folded into a "+n" that names them on hover. */
export function ThemePills({
  themes,
  className = 'justify-end',
}: {
  themes: string[]
  className?: string
}) {
  const extra = themes.slice(THEMES_SHOWN)
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {themes.slice(0, THEMES_SHOWN).map((t) => (
        <ThemePill key={t}>{t}</ThemePill>
      ))}
      {extra.length > 0 && (
        <Tooltip
          label={`${extra.length} more themes`}
          trigger={<ThemePill>+{extra.length}</ThemePill>}
        >
          {extra.join(', ')}
        </Tooltip>
      )}
    </span>
  )
}
