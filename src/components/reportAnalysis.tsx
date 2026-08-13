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
  pending: { label: 'Not analysed', className: 'bg-grey-100 text-grey-500' },
  analysed: { label: 'Analysed', className: 'bg-success/10 text-success' },
  error: { label: 'Analysis failed', className: 'bg-danger/10 text-danger' },
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
  if (score >= 8) return { text: 'text-success', bar: 'bg-success' }
  if (score >= 5) return { text: 'text-warning', bar: 'bg-warning' }
  return { text: 'text-danger', bar: 'bg-danger' }
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
      <div className="flex items-center justify-between text-label">
        <span className="text-grey-600">{title}</span>
        <span className={`font-semibold ${cls.text}`}>{score}/10</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-grey-100">
        <div className={`h-full rounded-full ${cls.bar}`} style={{ width: `${score * 10}%` }} />
      </div>
      {narrative && <p className="mt-1.5 text-label leading-relaxed text-grey-600">{narrative}</p>}
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
      <div className="flex items-center justify-between border-b border-grey-100 px-5 py-3">
        <div className="flex items-center gap-3">
          <h2 className="text-body font-medium text-grey-900">Report analysis</h2>
          <Badge className={meta.className}>{meta.label}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {analysedAt && (
            <span className="text-label text-grey-400">
              Analysed {new Date(analysedAt).toLocaleDateString('en-GB')}
            </span>
          )}
          {action}
        </div>
      </div>

      {status !== 'analysed' || !a ? (
        <p className="px-5 py-6 text-body text-grey-500">
          {status === 'error' ? 'Analysis failed. Try re-running.' : 'Not yet analysed.'}
        </p>
      ) : (
        <div className="flex flex-col gap-5 px-5 py-4 md:flex-row">
          {/* Impact figure + alignment bars */}
          <div className="md:w-44 md:shrink-0">
            <div className="flex flex-col items-center">
              <div
                className="flex h-16 min-w-16 flex-col items-center justify-center rounded-full px-3"
                style={{ border: `3px solid ${a.impactQuantity != null ? 'var(--color-brand)' : 'var(--color-grey-300)'}` }}
              >
                <span className="text-heading font-light leading-none">
                  {a.impactQuantity != null
                    ? Number(a.impactQuantity).toLocaleString('en-GB')
                    : '—'}
                </span>
              </div>
              <span className="mt-1.5 text-center text-label uppercase tracking-wide text-grey-400">
                {a.impactUnitLabel ?? 'Impact'}
                {a.impactQuantity != null && (
                  <>
                    {' · '}
                    {a.impactQuantitySource === 'reported' ? 'stated by charity' : 'AI extracted'}
                  </>
                )}
              </span>
              {a.impactQuantity == null && (
                <span className="mt-1 text-center text-label text-grey-400">
                  No quantity evidenced in the report
                </span>
              )}
              {a.impactQuantityQuote && (
                <p className="mt-2 border-l-2 border-grey-200 pl-2 text-label italic leading-snug text-grey-500">
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
                <h3 className="mb-1 text-label font-semibold uppercase tracking-wide text-grey-400">
                  AI assessment summary
                </h3>
                <p className="text-body leading-relaxed text-grey-700">{a.aiSummary}</p>
              </div>
            )}

            {a.applicationAlignment && (
              <div>
                <h3 className="mb-1 text-label font-semibold uppercase tracking-wide text-grey-400">
                  Against the application
                </h3>
                <p className="text-body leading-relaxed text-grey-600">
                  {a.applicationAlignment.narrative}
                </p>
                {a.applicationAlignment.promisesKept.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {a.applicationAlignment.promisesKept.map((p, i) => (
                      <li key={i} className="text-label text-success">
                        ✓ {p}
                      </li>
                    ))}
                  </ul>
                )}
                {a.applicationAlignment.promisesUnmet.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {a.applicationAlignment.promisesUnmet.map((p, i) => (
                      <li key={i} className="text-label text-warning">
                        ⚠ {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {a.programmeAlignment && (
              <div>
                <h3 className="mb-1 text-label font-semibold uppercase tracking-wide text-grey-400">
                  Against the programme
                </h3>
                <p className="text-body leading-relaxed text-grey-600">
                  {a.programmeAlignment.narrative}
                </p>
              </div>
            )}

            {(a.aiChallenges || a.aiLessons) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {a.aiChallenges && (
                  <div>
                    <h3 className="mb-1 text-label font-semibold uppercase tracking-wide text-grey-400">
                      Challenges
                    </h3>
                    <p className="text-label leading-relaxed text-grey-600">{a.aiChallenges}</p>
                  </div>
                )}
                {a.aiLessons && (
                  <div>
                    <h3 className="mb-1 text-label font-semibold uppercase tracking-wide text-grey-400">
                      Lessons learned
                    </h3>
                    <p className="text-label leading-relaxed text-grey-600">{a.aiLessons}</p>
                  </div>
                )}
              </div>
            )}

            {a.flags.length > 0 && (
              <div className="rounded-chip bg-warning/10 px-3 py-2.5">
                <h3 className="mb-1 text-label font-semibold uppercase tracking-wide text-warning">
                  Flags to check
                </h3>
                <ul className="space-y-1">
                  {a.flags.map((f, i) => (
                    <li key={i} className="text-label leading-relaxed text-warning">
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
