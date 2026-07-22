import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { anim, chart, fmtMoney, tooltipBox } from './theme'

export type GivingPoint = { label: string; amount: number }

function AreaTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={tooltipBox}>
      <div style={{ color: chart.sub }}>{label}</div>
      <div style={{ color: chart.ink, fontWeight: 600, marginTop: 2 }}>{fmtMoney(payload[0]!.value)}</div>
    </div>
  )
}

function axisMoney(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}m`
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`
  return String(v)
}

/** Monthly giving area chart — gradient fill, hover tooltip, on-load animation. */
export function GivingArea({ data, height = 210 }: { data: GivingPoint[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="givingFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={chart.purple} stopOpacity={0.28} />
            <stop offset="100%" stopColor={chart.purple} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={chart.grid} strokeDasharray="2 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: chart.faint }} dy={4} />
        <YAxis
          tickFormatter={axisMoney}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: chart.faint }}
          width={38}
        />
        <Tooltip content={<AreaTooltip />} cursor={{ stroke: chart.purple, strokeDasharray: '3 3' }} />
        <Area
          type="monotone"
          dataKey="amount"
          stroke={chart.purple}
          strokeWidth={2}
          fill="url(#givingFill)"
          dot={{ r: 2.5, fill: chart.purple, strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          {...anim}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
