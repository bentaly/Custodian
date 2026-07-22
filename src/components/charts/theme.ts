// Shared chart theme — the one place chart colours, tooltip styling and animation
// timing live, so every Recharts chart across Dashboard + Insights re-themes together.
// The named greys/status hues mirror the Figma variables; the purple + palette are the
// current comp approximations until those are tokenised.
export const chart = {
  ink: '#141C24',
  sub: '#637083',
  faint: '#98A2B3',
  grid: '#EAECF0',
  purple: '#8B7FF0',
  success: '#31A650',
  danger: '#FF4242',
  warning: '#F89828',
  info: '#3B82C4',
  allocateLeft: '#E9ECF1',
}

// Domain palette for categorical series (programmes, themes…).
export const seriesColors = ['#4FBEE8', '#F48FB1', '#F5B851', '#8B7FF0', '#5BD1B0', '#F0876B']

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
