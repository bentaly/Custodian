import { CRITERION_DEFINITIONS, CRITERION_ORDER } from '../../lib/custodianScore'
import type { CustodianScoreDetail, CustodianScoreStatus } from '../../lib/custodianScore/types'
import { ScoreRing } from '../charts/ScoreRing'
import { ProgressBar } from '../ProgressBar'
import { withAlpha } from '../BarMeter'
import { Button, Panel, PanelTitle } from '../ui'
import { C, bandForScore } from '../ui/tokens'

// The AI assessment of a sourced partner, drawn as an application's is: the composite out
// of 100 in a ring, the six criteria out of 10 beside it, on the same RAG bands. One score
// on one scale wherever it is quoted, which matters most here, because a partner taken
// straight to the shortlist carries this same result onto its application.
//
// It says "first screen" in words. The model is told it is looking at staff's note and the
// register rather than an organisation's answers, and a reader should be told too.

export function AssessmentPanel({
  status,
  score,
  detail,
  /** What the assessment still needs, in words. Empty when it can run. */
  gaps,
  canManage,
  running,
  onRerun,
  onRefresh,
}: {
  status: CustodianScoreStatus
  score: number | null
  detail: CustodianScoreDetail | null
  gaps: string[]
  canManage: boolean
  running: boolean
  onRerun: () => void
  onRefresh: () => void
}) {
  const scored = status === 'scored' && score !== null && detail !== null
  return (
    <Panel label="AI assessment">
      <PanelTitle
        right={
          canManage && gaps.length === 0 && status !== 'queued' && status !== 'pending' ? (
            <Button variant="secondary" size="sm" disabled={running} onClick={onRerun}>
              {running ? 'Starting…' : scored ? 'Re-run assessment' : 'Run assessment'}
            </Button>
          ) : undefined
        }
      >
        AI assessment
      </PanelTitle>

      {scored ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="flex flex-1 items-center gap-4">
              <ScoreRing score={score} />
              <div>
                <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
                  {detail.summary}
                </p>
                <span
                  className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-display text-micro font-medium"
                  style={{ backgroundColor: C.brandBg, color: C.brand }}
                >
                  AI analysis · first screen, from your note and the register
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3 lg:w-[260px] lg:shrink-0">
              {CRITERION_ORDER.map((key) => {
                const criterion = detail.criteria[key]
                if (!criterion) return null
                const colour = bandForScore(criterion.score, 10).fill
                return (
                  <div key={key} className="flex items-center gap-4" title={criterion.rationale}>
                    <span
                      className="w-[104px] shrink-0 font-display text-label font-medium"
                      style={{ color: C.ink }}
                    >
                      {CRITERION_DEFINITIONS[key].label}
                    </span>
                    <ProgressBar
                      className="flex-1"
                      value={criterion.score / 10}
                      colour={colour}
                      track={withAlpha(colour, 0.2)}
                      height={4}
                    />
                    <span
                      className="w-8 shrink-0 text-right font-display text-label font-medium tabular-nums"
                      style={{ color: C.sub }}
                    >
                      {criterion.score}/10
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          {detail.flags.length > 0 && (
            <div>
              <p
                className="font-display text-label uppercase tracking-wide"
                style={{ color: C.faint }}
              >
                To check
              </p>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
                {detail.flags.map((flag, i) => (
                  <li key={i} className="font-display text-body" style={{ color: C.body }}>
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : gaps.length > 0 ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          Waiting for {gaps.join(', ')}. Custodian assesses the fit with your giving strategy and
          the programme once they are in. Add them under Edit details.
        </p>
      ) : status === 'queued' ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-display text-body" style={{ color: C.sub }}>
            Running. It takes about a minute.
          </p>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      ) : (
        <p className="font-display text-body" style={{ color: C.sub }}>
          {status === 'error'
            ? 'The assessment could not be completed. Run it again.'
            : status === 'pending'
              ? 'AI assessment is not available at the moment.'
              : 'Not assessed yet.'}
        </p>
      )}
    </Panel>
  )
}
