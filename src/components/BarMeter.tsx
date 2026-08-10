// Reusable ticked bar-meter — the thin 3px bars used across the app (KPI cards,
// round-budget meters, the sign-in art). Two modes:
//   • segments — bars split proportionally across categories, always 100% full
//   • progress — a 0..1 fill; lit bars are solid `color`, the rest are the same
//                colour at `trackOpacity` (20% by default)
// Bars rise on load, staggered left-to-right, via the shared `.tick` animation
// (respects prefers-reduced-motion).

export type BarSegment = { value: number; color: string }

/** Any CSS colour → the same colour at the given alpha.
 *
 *  Uses `color-mix` rather than parsing hex digits: every colour in the app is now a
 *  `var(--color-*)` token, and the old hex maths silently produced `rgba(NaN, NaN, NaN)`
 *  the moment it was handed one — a bar that renders as nothing at all. */
export function withAlpha(color: string, alpha: number) {
  return `color-mix(in srgb, ${color} ${alpha * 100}%, transparent)`
}

export function BarMeter({
  bars = 32,
  segments,
  progress,
  color = 'var(--color-accent-violet)',
  trackOpacity = 0.2,
  height = 24,
  barWidth = 3,
  fill = false,
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
  /**
   * Fixed-pitch mode (Figma's repeated bar tile): bars sit on a constant ~6.7px
   * pitch and the strip is clipped to the container, so meters of different widths
   * share one bar rhythm. Only for single-colour strips — clipping would distort
   * the proportions of a multi-segment meter.
   */
  fill?: boolean
  animate?: boolean
  className?: string
}) {
  // Fill mode draws past the right edge and clips, so it needs more bars than the
  // widest plausible container.
  if (fill) bars = 160
  const colors: string[] = []
  if (segments && segments.length) {
    // Empty categories are dropped first: the last segment soaks up the rounding
    // remainder, so a zero-valued one left in place would be handed a bar and show
    // a category that isn't there (e.g. a red tick for "0 declined").
    const segs = segments.filter((s) => s.value > 0)
    const total = segs.reduce((s, x) => s + x.value, 0)
    if (total <= 0) {
      for (let i = 0; i < bars; i++) colors.push(withAlpha(color, trackOpacity))
    } else {
      let assigned = 0
      segs.forEach((seg, si) => {
        // Last segment soaks up the rounding remainder so the strip is always full.
        const n = si === segs.length - 1 ? bars - assigned : Math.round((bars * seg.value) / total)
        for (let k = 0; k < n; k++) colors.push(seg.color)
        assigned += n
      })
      while (colors.length < bars) colors.push(segs[segs.length - 1]!.color)
    }
  } else {
    const p = Math.max(0, Math.min(1, progress ?? 0))
    const filled = Math.round(bars * p)
    for (let i = 0; i < bars; i++) colors.push(i < filled ? color : withAlpha(color, trackOpacity))
  }

  return (
    <div
      className={`flex items-end ${fill ? 'gap-[3.68px] overflow-hidden' : 'justify-between'} ${className}`}
      style={{ height }}
    >
      {colors.slice(0, bars).map((c, i) => (
        <span
          key={i}
          className={animate ? 'tick' : ''}
          style={{
            width: barWidth,
            flexShrink: 0,
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
