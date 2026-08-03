import { chart } from './theme'

// The dot-matrix plot backdrop every graph sits on (Figma 128:42632 "Frame 91"):
// 3px Gray/100 dots on a 6px pitch. Figma draws it as thousands of ellipses; here
// it is one tiled radial-gradient, so it costs a single element and tiles to any
// plot size.
//
// Absolutely positioned — give the plot container `relative` and render the
// series above it (`relative`/`z-10`).
export function DotGrid({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage: `radial-gradient(circle at center, ${chart.dot} 1.5px, transparent 1.6px)`,
        backgroundSize: '6px 6px',
      }}
    />
  )
}
