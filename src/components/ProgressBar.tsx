// Reusable horizontal progress/budget bar — a rounded track with a coloured fill
// (e.g. committed vs budget). The fill grows from the left on load via the shared
// `.bar-grow` animation (same easing as the tick meters); pass a `delay` to stagger a
// list of them. Respects prefers-reduced-motion.
export function ProgressBar({
  value,
  color,
  track = '#F2F4F7',
  height = 6,
  delay = 0,
  animate = true,
  className = '',
}: {
  /** Fill fraction, 0..1 (clamped). */
  value: number
  color: string
  track?: string
  height?: number
  /** Stagger in ms, for a list of bars. */
  delay?: number
  animate?: boolean
  className?: string
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={`overflow-hidden rounded-full ${className}`} style={{ height, backgroundColor: track }}>
      <div
        className={`h-full rounded-full ${animate ? 'bar-grow' : ''}`}
        style={{
          width: `${pct}%`,
          backgroundColor: color,
          animationDelay: animate ? `${delay}ms` : undefined,
        }}
      />
    </div>
  )
}
