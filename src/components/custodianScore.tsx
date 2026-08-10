// ─── Custodian score UI ───────────────────────────────────────────────────────
//
// Presentation only. Reads the stored composite + { criteria, summary, flags }
// and renders the score circle, per-criterion breakdown, AI assessment summary,
// and reviewer flags. Criterion labels are looked up from the registry by key —
// they are not persisted.

import type { ReactNode } from 'react'
import {
  CRITERION_DEFINITIONS,
  CRITERION_ORDER,
  type CustodianScoreDetail,
  type CustodianScoreStatus,
} from '../lib/custodianScore'
import { Badge, Card } from './ui'

const STATUS_META: Record<CustodianScoreStatus, { label: string; className: string }> = {
  pending: { label: 'Not scored', className: 'bg-gray-100 text-gray-500' },
  scored: { label: 'Scored', className: 'bg-success/10 text-success' },
  error: { label: 'Scoring failed', className: 'bg-danger/10 text-danger' },
}

/** Composite 0–100 colour band. */
function compositeColor(score: number): string {
  if (score >= 75) return 'var(--color-brand)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

/** Per-criterion 1–10 colour band (text classes). */
function criterionClasses(score: number): { text: string; bar: string } {
  if (score >= 8) return { text: 'text-success', bar: 'bg-success' }
  if (score >= 5) return { text: 'text-warning', bar: 'bg-warning' }
  return { text: 'text-danger', bar: 'bg-danger' }
}

export function CustodianScorePanel({
  status,
  score,
  detail,
  scoredAt,
  action,
}: {
  status: CustodianScoreStatus
  score: number | null | undefined
  detail: CustodianScoreDetail | null | undefined
  scoredAt?: string | Date | null
  /** Optional action slot in the header (e.g. a re-run button). */
  action?: ReactNode
}) {
  const meta = STATUS_META[status] ?? STATUS_META.pending

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-body font-medium text-gray-900">Custodian score</h2>
          <Badge className={meta.className}>{meta.label}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {scoredAt && (
            <span className="text-label text-gray-400">
              Scored {new Date(scoredAt).toLocaleDateString('en-GB')}
            </span>
          )}
          {action}
        </div>
      </div>

      {status !== 'scored' || score == null || !detail ? (
        <p className="px-5 py-6 text-body text-gray-500">
          {status === 'error'
            ? `Scoring failed${detail?.error ? ` — ${detail.error}` : ''}. Try re-running.`
            : 'Not yet scored.'}
        </p>
      ) : (
        <div className="flex flex-col gap-5 px-5 py-4 md:flex-row">
          {/* Composite + criteria breakdown */}
          <div className="md:w-44 md:shrink-0">
            <div className="flex flex-col items-center">
              <div
                className="flex h-16 w-16 flex-col items-center justify-center rounded-full"
                style={{ border: `3px solid ${compositeColor(score)}` }}
              >
                <span className="text-heading font-light leading-none">{score}</span>
                <span className="text-label text-gray-400">/100</span>
              </div>
              <span className="mt-1.5 text-label uppercase tracking-wide text-gray-400">
                AI composite score
              </span>
            </div>

            <ul className="mt-4 space-y-2">
              {CRITERION_ORDER.map((key) => {
                const c = detail.criteria[key]
                if (!c) return null
                const def = CRITERION_DEFINITIONS[key]
                const cls = criterionClasses(c.score)
                return (
                  <li key={key} title={c.rationale}>
                    <div className="flex items-center justify-between text-label">
                      <span className="text-gray-600">{def.label}</span>
                      <span className={`font-semibold ${cls.text}`}>{c.score}/10</span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${cls.bar}`}
                        style={{ width: `${c.score * 10}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Summary + flags */}
          <div className="flex-1 space-y-4">
            <div>
              <h3 className="mb-2 text-label font-medium uppercase tracking-wide text-gray-400">
                AI assessment summary
              </h3>
              <div className="rounded-chip bg-gray-50 p-3">
                <span className="mb-1.5 inline-block rounded-chip bg-success/10 px-1.5 py-0.5 text-label font-semibold text-success">
                  AI analysis
                </span>
                <p className="text-body leading-relaxed text-gray-700">{detail.summary}</p>
              </div>
            </div>

            {detail.flags.length > 0 && (
              <div>
                <h3 className="mb-2 text-label font-medium uppercase tracking-wide text-gray-400">
                  Flags to review
                </h3>
                <ul className="space-y-1.5">
                  {detail.flags.map((flag, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 rounded-chip bg-warning/10 px-2.5 py-1.5 text-body text-warning"
                    >
                      <span className="mt-0.5 shrink-0">⚠</span>
                      <span>{flag}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
