// Shared chart theme — the one place chart colours, tooltip styling and animation
// timing live, so every Recharts chart across Dashboard + Insights re-themes together.
// The named greys/status hues mirror the Figma variables; the purple + palette are the
// current comp approximations until those are tokenised.
export const chart = {
  ink: 'var(--color-grey-900)',
  sub: 'var(--color-grey-500)',
  faint: 'var(--color-grey-400)',
  grid: 'var(--color-grey-200)',
  /** Gray/100 — the dot-grid plot backdrop. */
  dot: 'var(--color-grey-100)',
  purple: 'var(--color-accent-violet)',
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
  allocateLeft: 'var(--color-grey-200)',
}

// On-load animation — one timing shared by every chart.
export const anim = { isAnimationActive: true, animationBegin: 0, animationDuration: 700 } as const

// Compact £ formatter for tooltips + axis ticks.
export function fmtMoney(n: number) {
  const neg = n < 0
  const a = Math.abs(n)
  let s: string
  if (a >= 1_000_000) s = `£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`
  else if (a >= 1_000) s = `£${Math.round(a / 1_000)}k`
  else s = `£${Math.round(a).toLocaleString('en-GB')}`
  return neg ? `-${s}` : s
}

// Shared tooltip chrome (applied to a plain div in each chart's custom tooltip).
export const tooltipBox: React.CSSProperties = {
  background: '#fff',
  border: `1px solid ${chart.grid}`,
  borderRadius: 10,
  boxShadow: '0 6px 20px rgba(16,24,40,0.10)',
  padding: '8px 10px',
  fontSize: 12,
  lineHeight: 1.35,
}
