// ─── Due diligence UI ────────────────────────────────────────────────────────
//
// Presentation only. Reads the stored { key, source, result, detail } records
// and looks up label / level from the definitions registry — the level and
// label are deliberately NOT persisted.

import type { ReactNode } from 'react'
import {
  CHECK_DEFINITIONS,
  type CheckOutcome,
  type DueDiligenceCheckRecord,
  type DueDiligenceSource,
  type DueDiligenceStatus,
} from '../lib/dueDiligence'
import { Badge, Card } from './ui'

const STATUS_META: Record<DueDiligenceStatus, { label: string; className: string }> = {
  pending: { label: 'Not screened', className: 'bg-gray-100 text-gray-500' },
  clear: { label: 'DD cleared', className: 'bg-green-50 text-green-700' },
  warning: { label: 'DD warnings', className: 'bg-amber-50 text-amber-700' },
  blocked: { label: 'DD blocked', className: 'bg-red-50 text-red-600' },
  review: { label: 'Manual review', className: 'bg-blue-50 text-blue-700' },
}

const SOURCE_LABELS: Record<DueDiligenceSource, string> = {
  charity_commission: 'Charity Commission',
  oscr: 'OSCR',
  companies_house: 'Companies House',
  threesixtygiving: '360Giving',
}

const OUTCOME_META: Record<CheckOutcome, { symbol: string; className: string }> = {
  pass: { symbol: '✓', className: 'text-green-600' },
  fail: { symbol: '✕', className: 'text-red-600' },
  unverified: { symbol: '–', className: 'text-gray-400' },
}

export function DueDiligenceBadge({ status }: { status: DueDiligenceStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending
  return <Badge className={meta.className}>{meta.label}</Badge>
}

export function DueDiligencePanel({
  status,
  checks,
  checkedAt,
  action,
}: {
  status: DueDiligenceStatus
  checks: DueDiligenceCheckRecord[] | null | undefined
  checkedAt?: string | Date | null
  /** Optional action slot rendered in the header (e.g. a re-run button). */
  action?: ReactNode
}) {
  const records = checks ?? []

  // Group by register, preserving first-seen order.
  const bySource = new Map<DueDiligenceSource, DueDiligenceCheckRecord[]>()
  for (const r of records) {
    const arr = bySource.get(r.source) ?? []
    arr.push(r)
    bySource.set(r.source, arr)
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-gray-900">Due diligence</h2>
          <DueDiligenceBadge status={status} />
        </div>
        <div className="flex items-center gap-3">
          {checkedAt && (
            <span className="text-xs text-gray-400">
              Screened {new Date(checkedAt).toLocaleDateString('en-GB')}
            </span>
          )}
          {action}
        </div>
      </div>

      {records.length === 0 ? (
        <p className="px-5 py-6 text-sm text-gray-500">
          {status === 'review'
            ? 'Could not screen automatically — manual review required.'
            : 'No checks recorded.'}
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {[...bySource.entries()].map(([source, rows]) => (
            <div key={source} className="px-5 py-3">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
                {SOURCE_LABELS[source]}
              </h3>
              <ul className="space-y-1.5">
                {rows.map((r) => {
                  const def = CHECK_DEFINITIONS[r.key]
                  const o = OUTCOME_META[r.result]
                  return (
                    <li key={r.key} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 w-3 shrink-0 font-semibold ${o.className}`}>
                        {o.symbol}
                      </span>
                      <span className="text-gray-700">{def.label}</span>
                      {r.result === 'fail' && (
                        <span
                          className={`rounded px-1.5 text-xs ${
                            def.level === 'block'
                              ? 'bg-red-50 text-red-600'
                              : def.level === 'warning'
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          {def.level}
                        </span>
                      )}
                      {r.detail && <span className="text-gray-400">— {r.detail}</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
