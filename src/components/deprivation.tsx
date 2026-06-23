// ─── Deprivation context UI ───────────────────────────────────────────────────
//
// Presentation only. Renders the stored DeprivationResult: a decile range + spread
// for a resolved location, or an honest "too broad" / "couldn't resolve" / "not
// assessed" state otherwise. Deciles are within-nation, so every reading is labelled
// with its nation's index + vintage and never compared across the border.

import type { ReactNode } from 'react'
import {
  formatDecileRange,
  type DeprivationContext,
  type DeprivationResult,
  type DeprivationStatus,
} from '../lib/deprivation/types'

const STATUS_META: Record<DeprivationStatus, { label: string; className: string }> = {
  pending: { label: 'Not assessed', className: 'bg-gray-100 text-gray-500' },
  resolved: { label: 'Resolved', className: 'bg-green-50 text-green-700' },
  too_broad: { label: 'Too broad', className: 'bg-amber-50 text-amber-700' },
  unresolvable: { label: 'Unresolved', className: 'bg-gray-100 text-gray-500' },
}

const AREA_TYPE_LABEL: Record<DeprivationContext['areaType'], string> = {
  lsoa: 'neighbourhood',
  ward: 'ward',
  lad: 'local authority',
  region: 'region',
}

// Decile 1 = most deprived (red) … 10 = least deprived (green).
function decileColor(decile: number): string {
  if (decile <= 2) return '#A32D2D'
  if (decile <= 4) return '#C2410C'
  if (decile <= 6) return '#B45309'
  if (decile <= 8) return '#4D7C0F'
  return '#0F6E56'
}

/** A 10-cell strip showing the spread of deciles across the matched areas. Cells in
 *  the [min,max] range are coloured (opacity ∝ how many areas fall in that decile);
 *  cells outside the range are faint. */
function DecileStrip({ ctx }: { ctx: DeprivationContext }) {
  const maxCount = Math.max(1, ...ctx.histogram)
  return (
    <div className="flex gap-0.5">
      {ctx.histogram.map((count, i) => {
        const decile = i + 1
        const inRange = decile >= ctx.min && decile <= ctx.max
        return (
          <div
            key={decile}
            title={`Decile ${decile}: ${count} area${count === 1 ? '' : 's'}`}
            className="h-6 flex-1 rounded-sm"
            style={{
              backgroundColor: inRange ? decileColor(decile) : '#F3F4F6',
              opacity: inRange ? 0.35 + 0.65 * (count / maxCount) : 1,
            }}
          />
        )
      })}
    </div>
  )
}

export function DeprivationPanel({
  status,
  context,
  resolvedAt,
  action,
}: {
  status: DeprivationStatus
  context: DeprivationResult | null | undefined
  resolvedAt?: string | Date | null
  /** Optional action slot in the header (e.g. a re-run button). */
  action?: ReactNode
}) {
  const meta = STATUS_META[status] ?? STATUS_META.pending
  const resolved = context && context.status === 'resolved' ? context : null

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-900">Deprivation context</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
            {meta.label}
          </span>
          {resolved && (
            <span className="text-xs text-gray-400">
              Index of Multiple Deprivation · {resolved.vintage}
            </span>
          )}
        </div>
        {action}
      </div>

      <div className="px-5 py-4">
        {resolved ? (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold" style={{ color: decileColor(resolved.median) }}>
                {formatDecileRange(resolved)}
              </span>
              {resolved.count > 1 && (
                <span className="text-sm text-gray-500">median {resolved.median}</span>
              )}
            </div>
            <DecileStrip ctx={resolved} />
            <div className="flex justify-between text-[10px] uppercase tracking-wide text-gray-400">
              <span>1 · most deprived</span>
              <span>10 · least deprived</span>
            </div>
            <p className="text-xs text-gray-500">
              {resolved.areaName} · {AREA_TYPE_LABEL[resolved.areaType]}
              {resolved.count > 1 && ` · ${resolved.count.toLocaleString('en-GB')} neighbourhoods`}
              <span className="text-gray-400"> · from “{resolved.input}”</span>
            </p>
          </div>
        ) : status === 'too_broad' ? (
          <p className="text-sm text-gray-500">
            “{context?.status === 'too_broad' ? context.matchedName : 'This location'}” covers too
            wide an area to give a meaningful deprivation figure
            {context?.status === 'too_broad' && ` (~${Math.round(context.extentKm)} km across)`}.
          </p>
        ) : status === 'unresolvable' ? (
          <p className="text-sm text-gray-500">
            Couldn’t determine deprivation for
            {context?.status === 'unresolvable' ? ` “${context.input}”` : ' this location'} — the
            location wasn’t recognised.
          </p>
        ) : (
          <p className="text-sm text-gray-400">
            No location on this application to assess.
          </p>
        )}
      </div>
    </div>
  )
}
