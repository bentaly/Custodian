// Reusable ticked bar-meter — the thin 3px bars used across the app (KPI cards,
// round-budget meters, the sign-in art). Two modes:
//   • segments — bars split proportionally across categories, always 100% full
//   • progress — a 0..1 fill; lit bars are solid `colour`, the rest are the same
//                colour at `trackOpacity` (20% by default)
// Bars rise on load, staggered left-to-right, via the shared `.tick` animation
// (respects prefers-reduced-motion).

import { useEffect, useRef, useState } from 'react'

export type BarSegment = { value: number; colour: string }

/** Fixed-pitch mode's gap. Figma's repeated bar tile is a 3px bar on a 6.68px pitch. */
const FILL_GAP = 3.68

/** Any CSS colour → the same colour at the given alpha.
 *
 *  Uses `color-mix` rather than parsing hex digits: every colour in the app is now a
 *  `var(--color-*)` token, and the old hex maths silently produced `rgba(NaN, NaN, NaN)`
 *  the moment it was handed one — a bar that renders as nothing at all. */
export function withAlpha(colour: string, alpha: number) {
  return `color-mix(in srgb, ${colour} ${alpha * 100}%, transparent)`
}

export function BarMeter({
  bars = 32,
  segments,
  progress,
  colour = 'var(--color-accent-violet)',
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
  colour?: string
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
  // Fill mode covers the container whatever its width, so the count is MEASURED
  // rather than guessed. A fixed count (it was 160, ~1065px at the default pitch)
  // is a strip that stops short on any panel wider than that — a full-width
  // "100%" meter that visibly ends two-thirds of the way across — and one that
  // renders hundreds of clipped bars, each carrying its own stagger delay, on any
  // panel narrower. `bars` is the pre-measure fallback for SSR and first paint.
  const stripRef = useRef<HTMLDivElement>(null)
  const [fillBars, setFillBars] = useState<number | null>(null)
  useEffect(() => {
    const el = stripRef.current
    if (!fill || !el) return
    const measure = () =>
      setFillBars(Math.max(1, Math.ceil((el.clientWidth + FILL_GAP) / (barWidth + FILL_GAP))))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill, barWidth])

  if (fill) bars = fillBars ?? 160
  const colours: string[] = []
  if (segments && segments.length) {
    // Empty categories are dropped first: the last segment soaks up the rounding
    // remainder, so a zero-valued one left in place would be handed a bar and show
    // a category that isn't there (e.g. a red tick for "0 declined").
    const segs = segments.filter((s) => s.value > 0)
    const total = segs.reduce((s, x) => s + x.value, 0)
    if (total <= 0) {
      for (let i = 0; i < bars; i++) colours.push(withAlpha(colour, trackOpacity))
    } else {
      let assigned = 0
      segs.forEach((seg, si) => {
        // Last segment soaks up the rounding remainder so the strip is always full.
        const n = si === segs.length - 1 ? bars - assigned : Math.round((bars * seg.value) / total)
        for (let k = 0; k < n; k++) colours.push(seg.colour)
        assigned += n
      })
      while (colours.length < bars) colours.push(segs[segs.length - 1]!.colour)
    }
  } else {
    const p = Math.max(0, Math.min(1, progress ?? 0))
    const filled = Math.round(bars * p)
    for (let i = 0; i < bars; i++)
      colours.push(i < filled ? colour : withAlpha(colour, trackOpacity))
  }

  return (
    <div
      ref={stripRef}
      className={`flex items-end ${fill ? 'overflow-hidden' : 'justify-between'} ${className}`}
      style={{ height, gap: fill ? FILL_GAP : undefined }}
    >
      {colours.slice(0, bars).map((c, i) => (
        <span
          key={i}
          // `tick` is the once-on-load rise; `tick-shift` carries the meter between
          // states afterwards. Both are keyed on the bar's index so the wave runs
          // left-to-right, and both are inert under prefers-reduced-motion.
          className={animate ? 'tick tick-shift' : ''}
          style={{
            width: barWidth,
            flexShrink: 0,
            height: '100%',
            borderRadius: 9999,
            backgroundColor: c,
            animationDelay: animate ? `${i * 11}ms` : undefined,
            // Faster stagger than the load rise: this fires on every filter change, so
            // it has to feel like a response, not a performance.
            transitionDelay: animate ? `${i * 4}ms` : undefined,
          }}
        />
      ))}
    </div>
  )
}
