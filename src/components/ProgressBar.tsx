// Reusable horizontal progress/budget bar — a rounded track with a coloured fill
// (e.g. committed vs budget). The fill grows from the left on load via the shared
// `.bar-grow` animation (same easing as the tick meters); pass a `delay` to stagger a
// list of them. Respects prefers-reduced-motion.
//
// Two modes:
//   • value    — a single 0..1 fill in `colour` (the dashboard's round meters)
//   • segments — several bands sharing one fill, each a 0..1 fraction of the WHOLE bar
//                (proposed + already committed; paid + committed-not-yet-paid). The
//                bands are wrapped in one `.bar-grow` so the fill grows as a single
//                object rather than as a race between its own parts.
export function ProgressBar({
  value,
  segments,
  colour = 'var(--color-brand)',
  track = 'var(--color-grey-100)',
  height = 6,
  delay = 0,
  animate = true,
  className = '',
}: {
  /** Fill fraction, 0..1 (clamped). Ignored when `segments` is given. */
  value?: number
  /** Stacked mode: bands left-to-right, each a 0..1 fraction of the whole bar. */
  segments?: Array<{ value: number; colour: string }>
  colour?: string
  track?: string
  height?: number
  /** Stagger in ms, for a list of bars. */
  delay?: number
  animate?: boolean
  className?: string
}) {
  const bands = (segments ?? [{ value: value ?? 0, colour }]).filter((s) => s.value > 0)
  // Clamped as a whole, not band by band: two bands of 0.7 and 0.5 must divide the bar
  // between them, not each claim most of it and overflow.
  const filled = Math.min(1, Math.max(0, bands.reduce((s, b) => s + b.value, 0)))

  return (
    <div
      className={`overflow-hidden rounded-full ${className}`}
      style={{ height, backgroundColor: track }}
    >
      <div
        className={`flex h-full rounded-full ${animate ? 'bar-grow' : ''}`}
        style={{
          width: `${filled * 100}%`,
          animationDelay: animate ? `${delay}ms` : undefined,
        }}
      >
        {bands.map((b, i) => (
          <span
            key={i}
            className="h-full"
            // Proportions inside the fill, so rounding can never leave a hairline gap at
            // the right-hand end of a bar that is meant to be full.
            style={{ flex: `${b.value} 1 0`, backgroundColor: b.colour }}
          />
        ))}
      </div>
    </div>
  )
}
