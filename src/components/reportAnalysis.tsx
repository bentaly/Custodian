// ─── Report analysis UI ───────────────────────────────────────────────────────
//
// Presentation only. Renders the AI analysis of a grant report — impact figure,
// summary, alignment against the application's promises and the programme's
// goal, challenges/lessons digests, and reviewer flags. Styled to sit alongside
// CustodianScorePanel on a detail screen.

import type { ReactNode } from 'react'
import { Badge, Card } from './ui'

export type ReportAnalysisStatus = 'pending' | 'analysed' | 'error'

const STATUS_META: Record<ReportAnalysisStatus, { label: string; className: string }> = {
  pending: { label: 'Not analysed', className: 'bg-gray-100 text-gray-500' },
  analysed: { label: 'Analysed', className: 'bg-green-50 text-green-700' },
  error: { label: 'Analysis failed', className: 'bg-red-50 text-red-600' },
}

export interface ReportAnalysisData {
  aiSummary: string | null
  aiChallenges: string | null
  aiLessons: string | null
  applicationAlignment: {
    score: number
    narrative: string
    promisesKept: string[]
    promisesUnmet: string[]
  } | null
  programmeAlignment: { score: number; narrative: string } | null
  impactQuantity: string | null
  impactQuantitySource: string | null
  impactQuantityQuote: string | null
  impactUnitLabel: string | null
  flags: string[]
}

/** Per-alignment 1–10 colour band, matching the Custodian score criterion bands. */
function alignmentClasses(score: number): { text: string; bar: string } {
  if (score >= 8) return { text: 'text-green-700', bar: 'bg-green-600' }
  if (score >= 5) return { text: 'text-amber-700', bar: 'bg-amber-500' }
  return { text: 'text-red-600', bar: 'bg-red-500' }
}

function AlignmentBlock({
  title,
  score,
  narrative,
  children,
}: {
  title: string
  score: number
  narrative: string
  children?: ReactNode
}) {
  const cls = alignmentClasses(score)
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-600">{title}</span>
        <span className={`font-semibold ${cls.text}`}>{score}/10</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-gray-100">
        <div className={`h-full rounded ${cls.bar}`} style={{ width: `${score * 10}%` }} />
      </div>
      {narrative && <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{narrative}</p>}
      {children}
    </div>
  )
}

export function ReportAnalysisPanel({
  status,
  analysis,
  analysedAt,
  action,
}: {
  status: ReportAnalysisStatus
  analysis: ReportAnalysisData | null
  analysedAt?: string | Date | null
  /** Optional action slot in the header (e.g. a re-run button). */
  action?: ReactNode
}) {
  const meta = STATUS_META[status] ?? STATUS_META.pending
  const a = analysis

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-gray-900">Report analysis</h2>
          <Badge className={meta.className}>{meta.label}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {analysedAt && (
            <span className="text-xs text-gray-400">
              Analysed {new Date(analysedAt).toLocaleDateString('en-GB')}
            </span>
          )}
          {action}
        </div>
      </div>

      {status !== 'analysed' || !a ? (
        <p className="px-5 py-6 text-sm text-gray-500">
          {status === 'error' ? 'Analysis failed. Try re-running.' : 'Not yet analysed.'}
        </p>
      ) : (
        <div className="flex flex-col gap-5 px-5 py-4 md:flex-row">
          {/* Impact figure + alignment bars */}
          <div className="md:w-44 md:shrink-0">
            <div className="flex flex-col items-center">
              <div
                className="flex h-16 min-w-16 flex-col items-center justify-center rounded-full px-3"
                style={{ border: `3px solid ${a.impactQuantity != null ? '#0F6E56' : '#d1d5db'}` }}
              >
                <span className="text-2xl font-light leading-none">
                  {a.impactQuantity != null ? Number(a.impactQuantity).toLocaleString('en-GB') : '—'}
                </span>
              </div>
              <span className="mt-1.5 text-center text-[10px] uppercase tracking-wide text-gray-400">
                {a.impactUnitLabel ?? 'Impact'}
                {a.impactQuantity != null && (
                  <>
                    {' · '}
                    {a.impactQuantitySource === 'reported' ? 'stated by charity' : 'AI extracted'}
                  </>
                )}
              </span>
              {a.impactQuantity == null && (
                <span className="mt-1 text-center text-[10px] text-gray-400">
                  No quantity evidenced in the report
                </span>
              )}
              {a.impactQuantityQuote && (
                <p className="mt-2 border-l-2 border-gray-200 pl-2 text-[11px] italic leading-snug text-gray-500">
                  “{a.impactQuantityQuote}”
                </p>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {a.applicationAlignment && (
                <AlignmentBlock
                  title="Vs application"
                  score={a.applicationAlignment.score}
                  narrative=""
                />
              )}
              {a.programmeAlignment && (
                <AlignmentBlock
                  title="Vs programme"
                  score={a.programmeAlignment.score}
                  narrative=""
                />
              )}
            </div>
          </div>

          {/* Narrative side */}
          <div className="min-w-0 flex-1 space-y-4">
            {a.aiSummary && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  AI assessment summary
                </h3>
                <p className="text-sm leading-relaxed text-gray-700">{a.aiSummary}</p>
              </div>
            )}

            {a.applicationAlignment && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Against the application
                </h3>
                <p className="text-sm leading-relaxed text-gray-600">
                  {a.applicationAlignment.narrative}
                </p>
                {a.applicationAlignment.promisesKept.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {a.applicationAlignment.promisesKept.map((p, i) => (
                      <li key={i} className="text-xs text-green-700">
                        ✓ {p}
                      </li>
                    ))}
                  </ul>
                )}
                {a.applicationAlignment.promisesUnmet.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {a.applicationAlignment.promisesUnmet.map((p, i) => (
                      <li key={i} className="text-xs text-amber-700">
                        ⚠ {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {a.programmeAlignment && (
              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Against the programme
                </h3>
                <p className="text-sm leading-relaxed text-gray-600">{a.programmeAlignment.narrative}</p>
              </div>
            )}

            {(a.aiChallenges || a.aiLessons) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {a.aiChallenges && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Challenges
                    </h3>
                    <p className="text-xs leading-relaxed text-gray-600">{a.aiChallenges}</p>
                  </div>
                )}
                {a.aiLessons && (
                  <div>
                    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                      Lessons learned
                    </h3>
                    <p className="text-xs leading-relaxed text-gray-600">{a.aiLessons}</p>
                  </div>
                )}
              </div>
            )}

            {a.flags.length > 0 && (
              <div className="rounded-md bg-amber-50 px-3 py-2.5">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Flags to check
                </h3>
                <ul className="space-y-1">
                  {a.flags.map((f, i) => (
                    <li key={i} className="text-xs leading-relaxed text-amber-800">
                      {f}
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
