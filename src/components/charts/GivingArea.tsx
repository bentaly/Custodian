import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { anim, chart, fmtMoney, lineChart, tooltipBox } from './theme'

export type GivingPoint = {
  /** What the x axis prints. */
  label: string
  amount: number
  /** The tooltip's heading, where the axis label is a shortened form of it. */
  title?: string
}

function AreaTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number; payload?: GivingPoint }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={tooltipBox}>
      <div style={{ color: chart.sub }}>{payload[0]!.payload?.title ?? label}</div>
      <div style={{ color: chart.ink, fontWeight: 600, marginTop: 2 }}>
        {fmtMoney(payload[0]!.value)}
      </div>
    </div>
  )
}

function axisMoney(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}m`
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(v)
}

/** A tick cut to `max` characters, so a long round name cannot claim the axis. */
function clip(max: number | undefined) {
  return max === undefined
    ? undefined
    : (v: string) => (v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v)
}

/**
 * Money over time — gradient fill, hover tooltip, on-load animation. The app's ONE
 * line chart: the dashboard's "Giving so far" (quarters) and Insights' "Commitment
 * over time" (rounds) both draw with it.
 *
 * Insights had a hand-drawn chart of its own until 2026-09-24, built on three
 * assumptions that all failed: that a portfolio has a handful of rounds (an imported
 * back catalogue has dozens, and every label under it squeezed to "£1…"), that it
 * needed a bars mode on the same scale (dropped), and that Recharts is not keyboard-
 * readable (in v3 `accessibilityLayer` is on by default: Tab in, arrows step the
 * points, the tooltip follows). What this gives both screens is Recharts' tick
 * thinning, which is what makes a long series readable at all.
 */
export function GivingArea({
  data,
  height = 210,
  maxTickChars,
  animate = true,
}: {
  data: GivingPoint[]
  height?: number
  /** Cut longer axis labels to this many characters; the tooltip keeps the whole name
   *  (`title`). For categories with free-text names, such as rounds. */
  maxTickChars?: number
  /** Play the draw-in. A caller revealing the chart on scroll passes false until then
   *  and re-keys it, as the area donut does, so the animation plays when it is seen. */
  animate?: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="givingFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineChart.stroke} stopOpacity={lineChart.fillTop} />
            <stop offset="100%" stopColor={lineChart.stroke} stopOpacity={lineChart.fillBottom} />
          </linearGradient>
          {/* Figma backdrop: 3px dots on a 6px grid, Gray/100 — not ruled lines. */}
          <pattern id="givingDots" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill={chart.dot} />
          </pattern>
        </defs>
        {/* `fill` paints the plot-area rect; both rule sets stay off so only dots show. */}
        <CartesianGrid horizontal={false} vertical={false} fill="url(#givingDots)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: chart.faint }}
          tickFormatter={clip(maxTickChars)}
          dy={4}
        />
        <YAxis
          tickFormatter={axisMoney}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: chart.faint }}
          width={38}
        />
        <Tooltip
          content={<AreaTooltip />}
          cursor={{ stroke: chart.purple, strokeDasharray: '3 3' }}
        />
        <Area
          type="monotone"
          dataKey="amount"
          stroke={lineChart.stroke}
          strokeWidth={lineChart.strokeWidth}
          fill="url(#givingFill)"
          dot={{ r: 2.5, fill: chart.purple, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          {...anim}
          isAnimationActive={animate}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
