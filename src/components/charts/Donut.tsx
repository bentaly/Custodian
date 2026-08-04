import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { anim, chart, fmtMoney, tooltipBox } from './theme'

export type DonutSlice = {
  name: string
  value: number
  color: string
  /** Stable identity for cross-highlighting with a sibling map or list. Names
   *  are display strings and can collide or be renamed; ids are the area key. */
  areaId?: string
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload: DonutSlice }>
}) {
  if (!active || !payload?.length) return null
  const s = payload[0]!.payload
  return (
    <div style={tooltipBox}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: chart.ink,
          fontWeight: 500,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
        {s.name}
      </span>
      <div style={{ color: chart.sub, marginTop: 2 }}>{fmtMoney(s.value)}</div>
    </div>
  )
}

/**
 * Donut with an optional centred label overlay. Fixed square size (no ResponsiveContainer
 * needed) so it's SSR-clean. When every slice is zero it renders a single flat ring so the
 * shape is still visible.
 */
export function Donut({
  data,
  size = 140,
  thickness = 16,
  center,
  tooltip = true,
  highlight = null,
  onHighlight,
}: {
  data: DonutSlice[]
  size?: number
  thickness?: number
  center?: React.ReactNode
  /** Money-formatted hover tooltip. Off for non-monetary uses (e.g. a score gauge). */
  tooltip?: boolean
  /** Slice id held at full strength while the rest recede. */
  highlight?: string | null
  onHighlight?: (id: string | null) => void
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const slices: DonutSlice[] =
    total > 0
      ? data.filter((d) => d.value > 0)
      : [{ name: 'Empty', value: 1, color: chart.allocateLeft }]

  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <PieChart width={size} height={size}>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={size / 2 - thickness}
          outerRadius={size / 2}
          startAngle={90}
          endAngle={-270}
          stroke="none"
          onMouseEnter={(_, i) => onHighlight?.(slices[i]?.areaId ?? null)}
          onMouseLeave={() => onHighlight?.(null)}
          {...anim}
        >
          {slices.map((s, i) => (
            <Cell
              key={i}
              fill={s.color}
              // Recede, don't vanish: the ring has to stay a whole ring, or
              // hovering one area reads as the others losing their funding.
              //
              // No CSS transition here, however tempting. Recharts drives its
              // entry animation through the sector's inline style, so passing
              // `style` overwrites it every render and freezes the ring at
              // angle zero — it renders as a one-pixel sliver.
              fillOpacity={highlight !== null && s.areaId !== highlight ? 0.25 : 1}
            />
          ))}
        </Pie>
        {tooltip && total > 0 && (
          <Tooltip
            content={<DonutTooltip />}
            wrapperStyle={{ zIndex: 60, outline: 'none' }}
            allowEscapeViewBox={{ x: true, y: true }}
          />
        )}
      </PieChart>
      {center && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {center}
        </div>
      )}
    </div>
  )
}
