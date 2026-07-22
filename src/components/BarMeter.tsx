// Reusable ticked bar-meter — the thin 3px bars used across the app (KPI cards,
// round-budget meters, the sign-in art). Two modes:
//   • segments — bars split proportionally across categories, always 100% full
//   • progress — a 0..1 fill; lit bars are solid `color`, the rest are the same
//                colour at `trackOpacity` (20% by default)
// Bars rise on load, staggered left-to-right, via the shared `.tick` animation
// (respects prefers-reduced-motion).

export type BarSegment = { value: number; color: string }

/** #rrggbb → rgba() at the given alpha. */
export function withAlpha(hex: string, alpha: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function BarMeter({
  bars = 32,
  segments,
  progress,
  color = '#8B7FF0',
  trackOpacity = 0.2,
  height = 24,
  barWidth = 3,
  animate = true,
  className = '',
}: {
  bars?: number
  /** Segmented mode: bars coloured by category, proportional to each value. */
  segments?: BarSegment[]
  /** Progress mode (used when `segments` is absent): 0..1 lit fraction. */
  progress?: number
  /** Base colour for progress mode (and the unfilled track). */
  color?: string
  trackOpacity?: number
  height?: number
  barWidth?: number
  animate?: boolean
  className?: string
}) {
  const colors: string[] = []
  if (segments && segments.length) {
    const total = segments.reduce((s, x) => s + x.value, 0)
    if (total <= 0) {
      for (let i = 0; i < bars; i++) colors.push(withAlpha(color, trackOpacity))
    } else {
      let assigned = 0
      segments.forEach((seg, si) => {
        // Last segment soaks up the rounding remainder so the strip is always full.
        const n = si === segments.length - 1 ? bars - assigned : Math.round((bars * seg.value) / total)
        for (let k = 0; k < n; k++) colors.push(seg.color)
        assigned += n
      })
      while (colors.length < bars) colors.push(segments[segments.length - 1]!.color)
    }
  } else {
    const p = Math.max(0, Math.min(1, progress ?? 0))
    const filled = Math.round(bars * p)
    for (let i = 0; i < bars; i++) colors.push(i < filled ? color : withAlpha(color, trackOpacity))
  }

  return (
    <div className={`flex items-end justify-between ${className}`} style={{ height }}>
      {colors.slice(0, bars).map((c, i) => (
        <span
          key={i}
          className={animate ? 'tick' : ''}
          style={{
            width: barWidth,
            height: '100%',
            borderRadius: 9999,
            backgroundColor: c,
            animationDelay: animate ? `${i * 11}ms` : undefined,
          }}
        />
      ))}
    </div>
  )
}
