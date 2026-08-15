// ─── Report analysis UI ───────────────────────────────────────────────────────
//
// Presentation only. Renders the AI analysis of a grant report — the summary, alignment
// against the application's promises and the programme's goal, challenges/lessons
// digests, and reviewer flags.
//
// Drawn in the same vocabulary as the application detail's AI assessment, because it is
// the same kind of claim about the same organisation: a narrative beside a bank of 1–10
// criterion bars, banded on the app's one scale. The impact FIGURE deliberately does not
// live here — it is the headline number of the whole screen, so it sits in the stat row
// above with the money, and only its supporting quote stays with the analysis.

import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon, Tick01Icon } from '@hugeicons/core-free-icons'
import { Badge, Panel, PanelTitle } from './ui'
import { ProgressBar } from './ProgressBar'
import { C } from './ui/tokens'

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

/**
 * RAG colour for a 1–10 alignment score, on the SAME bands as the Custodian score's
 * criteria (`applications.$applicationId`): 7+ green, 4–6 amber, below 4 red. It used to
 * band at 8/5 here, which meant a 7 was green on one screen and amber on the next for no
 * reason a reader could ever discover.
 */
function ragColour(score: number) {
  if (score >= 7) return C.success
  if (score >= 4) return C.warning
  return C.danger
}

/** The criterion bar the application detail uses, on the report's two alignments. */
function AlignmentBar({ label, score }: { label: string; score: number }) {
  const colour = ragColour(score)
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-[104px] shrink-0 font-display text-label font-medium"
        style={{ color: C.ink }}
      >
        {label}
      </span>
      <ProgressBar
        className="flex-1"
        value={score / 10}
        colour={colour}
        track={`color-mix(in srgb, ${colour} 20%, transparent)`}
        height={4}
      />
      <span
        className="w-8 shrink-0 text-right font-display text-label font-medium tabular-nums"
        style={{ color: C.sub }}
      >
        {score}/10
      </span>
    </div>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h3
      className="mb-1 font-display text-label font-semibold uppercase tracking-wide"
      style={{ color: C.faint }}
    >
      {children}
    </h3>
  )
}

/** A promise the report kept or missed, as a tinted line — the same shape the Custodian
 *  score's flags wear, so "checked and fine" and "check this" are told apart by colour
 *  and icon rather than by a unicode character at the start of a sentence. */
function PromiseLine({ text, kept }: { text: string; kept: boolean }) {
  const colour = kept ? C.success : C.warning
  return (
    <li
      className="flex items-start gap-1.5 rounded-chip p-1.5 font-display text-label font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${colour} 8%, transparent)`, color: colour }}
    >
      <HugeiconsIcon
        icon={kept ? Tick01Icon : Alert02Icon}
        size={16}
        color="currentColor"
        className="mt-px shrink-0"
      />
      <span>{text}</span>
    </li>
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
    <Panel label="Report analysis">
      <PanelTitle
        right={
          <div className="flex items-center gap-3">
            <Badge className={meta.className}>{meta.label}</Badge>
            {analysedAt && (
              <span className="font-display text-label" style={{ color: C.faint }}>
                Analysed {new Date(analysedAt).toLocaleDateString('en-GB')}
              </span>
            )}
            {action}
          </div>
        }
      >
        Report analysis
      </PanelTitle>

      {status !== 'analysed' || !a ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          {status === 'error'
            ? 'Analysis failed — try re-running it.'
            : 'This report has not been analysed yet.'}
        </p>
      ) : (
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Summary + the quote the impact figure was read from, so the number in the
              stat row above can always be traced back to the grantee's own words. */}
          <div className="flex flex-1 flex-col gap-3">
            {a.aiSummary && (
              <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
                {a.aiSummary}
              </p>
            )}
            {a.impactQuantityQuote && (
              <blockquote
                className="border-l-2 pl-3 font-display text-label italic leading-relaxed"
                style={{ borderColor: C.line, color: C.sub }}
              >
                “{a.impactQuantityQuote}”
              </blockquote>
            )}
            <span
              className="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 font-display text-micro font-medium"
              style={{ backgroundColor: C.brandBg, color: C.brand }}
            >
              AI analysis
              {a.impactQuantity != null &&
                ` · impact ${a.impactQuantitySource === 'reported' ? 'stated by the charity' : 'read from the narrative'}`}
            </span>
          </div>

          {(a.applicationAlignment || a.programmeAlignment) && (
            <div className="flex flex-col gap-3 lg:w-[280px] lg:shrink-0">
              {a.applicationAlignment && (
                <AlignmentBar label="Vs application" score={a.applicationAlignment.score} />
              )}
              {a.programmeAlignment && (
                <AlignmentBar label="Vs programme" score={a.programmeAlignment.score} />
              )}
            </div>
          )}
        </div>
      )}

      {status === 'analysed' && a && (
        <div className="mt-6 flex flex-col gap-5 border-t pt-5" style={{ borderColor: C.wash }}>
          <div className="grid gap-5 lg:grid-cols-2">
            {a.applicationAlignment && (
              <div>
                <Heading>Against the application</Heading>
                <p className="font-display text-body leading-relaxed" style={{ color: C.body }}>
                  {a.applicationAlignment.narrative}
                </p>
                {(a.applicationAlignment.promisesKept.length > 0 ||
                  a.applicationAlignment.promisesUnmet.length > 0) && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {a.applicationAlignment.promisesKept.map((p, i) => (
                      <PromiseLine key={`kept-${i}`} text={p} kept />
                    ))}
                    {a.applicationAlignment.promisesUnmet.map((p, i) => (
                      <PromiseLine key={`unmet-${i}`} text={p} kept={false} />
                    ))}
                  </ul>
                )}
              </div>
            )}

            {a.programmeAlignment && (
              <div>
                <Heading>Against the programme</Heading>
                <p className="font-display text-body leading-relaxed" style={{ color: C.body }}>
                  {a.programmeAlignment.narrative}
                </p>
              </div>
            )}

            {a.aiChallenges && (
              <div>
                <Heading>Challenges</Heading>
                <p className="font-display text-body leading-relaxed" style={{ color: C.body }}>
                  {a.aiChallenges}
                </p>
              </div>
            )}

            {a.aiLessons && (
              <div>
                <Heading>Lessons learned</Heading>
                <p className="font-display text-body leading-relaxed" style={{ color: C.body }}>
                  {a.aiLessons}
                </p>
              </div>
            )}
          </div>

          {a.flags.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {a.flags.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 rounded-chip p-1.5 font-display text-label font-medium"
                  style={{ backgroundColor: C.dangerWash, color: C.danger }}
                >
                  <HugeiconsIcon
                    icon={Alert02Icon}
                    size={16}
                    color="currentColor"
                    className="mt-px shrink-0"
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  )
}
