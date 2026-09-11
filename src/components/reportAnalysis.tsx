// ─── Report analysis UI ───────────────────────────────────────────────────────
//
// Presentation only. Renders the AI analysis of a grant report as the report screen's
// main column (Figma 1190:5533): the summary (with a line each on challenges and lessons)
// and the impact figure beneath it, the two alignments side by side, the application's
// promises checked off, and reviewer flags.
// The headline ring for the two alignments sits in the screen's side column, so it is
// its own export (`AlignmentSummary`).
//
// Drawn in the same vocabulary as the application detail's AI assessment, because it is
// the same kind of claim about the same organisation: a narrative beside 1–10 criterion
// scores, banded on the app's one scale.

import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { ClampToggle, Panel, useClamp } from './ui'
import promiseMetIcon from './icons/promise-met.svg'
import promiseUnmetIcon from './icons/promise-unmet.svg'
import { Boundary } from './ui/Boundary'
import { ScoreRing } from './charts/ScoreRing'
import { ProgressBar } from './ProgressBar'
import { C, bandForScore } from './ui/tokens'
import { fmtDate } from '../lib/format'
import { fmtQuantity } from '../lib/reportTimeline'

export type ReportAnalysisStatus = 'pending' | 'analysed' | 'error'

export interface ReportAnalysisData {
  aiSummary: string | null
  /** One short line each, or null — see `challengesSummary` in `lib/reportAnalysis`. */
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
  flags: string[]
}

/** A card's title row: the title, an optional line under it, and a slot on the right. */
function CardHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
          {title}
        </h2>
        {sub && (
          <p className="font-display text-label leading-normal" style={{ color: C.sub }}>
            {sub}
          </p>
        )}
      </div>
      {right}
    </div>
  )
}

/**
 * A score or a tally, as the small chip at the right of a card's title. Tinted by the
 * score's RAG band rather than always green: `bandForScore` is the app's one rule, and a
 * 3/10 in brand green would read as a pass.
 */
function ScoreChip({ children, colour = C.brand }: { children: ReactNode; colour?: string }) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-control px-2 font-display text-label font-medium tabular-nums"
      style={{ backgroundColor: `color-mix(in srgb, ${colour} 10%, transparent)`, color: colour }}
    >
      {children}
    </span>
  )
}

/** Whether the report says what its impact figure was read from. */
function impactSourcePhrase(source: string | null) {
  return source === 'reported' ? 'stated by the charity' : 'read from the narrative'
}

/**
 * The report's own reading: the summary, the grantee's words the impact figure was taken
 * from, and — inset at the foot — the figure itself, set against what was proposed.
 */
export function ReportAnalysisCard({
  status,
  analysis,
  analysedAt,
  impact,
}: {
  status: ReportAnalysisStatus
  analysis: ReportAnalysisData | null
  analysedAt: string | null
  impact: {
    /** What the report is, where it sits: "Interim report · Warm Homes · Spring 2026". */
    title: string
    quantity: number | null
    unit: string | null
    /** Set against the proposal — see `againstProposal`. */
    comparison: { text: string; ahead: boolean } | null
  }
}) {
  const a = analysis
  const analysed = status === 'analysed' && a != null

  return (
    // `Panel`'s furniture with its own padding: the inset impact block runs nearly edge to
    // edge (4px) while the text above it keeps the card's usual 16px, so the card is
    // padded 4px and the text section 12px more.
    <div
      className="flex flex-col gap-5 rounded-card border bg-white px-1 pt-4 pb-1"
      style={{ borderColor: C.line }}
    >
      <Boundary label="Report analysis">
        <div className="flex flex-col gap-4 px-3">
          <CardHead
            title="Report analysis"
            right={
              <span
                className="shrink-0 whitespace-nowrap font-display text-body"
                style={{ color: status === 'error' ? C.danger : C.sub }}
              >
                {analysed
                  ? analysedAt
                    ? `Analysed on ${fmtDate(analysedAt)}`
                    : null
                  : status === 'error'
                    ? 'Analysis failed'
                    : 'Not analysed'}
              </span>
            }
          />

          {!analysed ? (
            <p className="font-display text-body" style={{ color: C.sub }}>
              {status === 'error'
                ? 'The analysis of this report failed. What the grantee sent is still there to read.'
                : 'This report has not been analysed yet.'}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {a.aiSummary && (
                <p className="font-display text-body leading-normal" style={{ color: C.body }}>
                  {a.aiSummary}
                </p>
              )}
              {(a.aiChallenges || a.aiLessons) && (
                <div className="flex flex-col gap-1.5">
                  {a.aiChallenges && <DigestLine label="Challenges" text={a.aiChallenges} />}
                  {a.aiLessons && <DigestLine label="Lessons" text={a.aiLessons} />}
                </div>
              )}
              <div className="flex flex-col items-start gap-2">
                {/* The grantee's own words the figure below was read from, so the number
                  can always be traced back to what they actually said. */}
                {a.impactQuantityQuote && (
                  <blockquote
                    className="border-l-2 pl-1.5 font-display text-label italic leading-normal"
                    style={{ borderColor: C.wash, color: C.sub }}
                  >
                    “{a.impactQuantityQuote}”
                  </blockquote>
                )}
                <span
                  className="inline-flex h-6 items-center gap-1 rounded-pill px-2 font-display text-label font-medium"
                  style={{ backgroundColor: C.successWash, color: C.success }}
                >
                  <span
                    className="size-[3px] shrink-0 rounded-full"
                    style={{ backgroundColor: C.success }}
                  />
                  AI analysis
                  {a.impactQuantity != null &&
                    ` · impact ${impactSourcePhrase(a.impactQuantitySource)}`}
                </span>
              </div>
            </div>
          )}
        </div>

        <div
          className="flex flex-col gap-3 rounded-control p-3"
          style={{ backgroundColor: C.wash }}
        >
          <p className="font-display text-body font-medium" style={{ color: C.ink }}>
            {impact.title}
          </p>
          {impact.quantity != null ? (
            <p className="flex flex-wrap items-baseline gap-x-1.5 font-display font-medium">
              <span className="text-heading leading-none tabular-nums" style={{ color: C.ink }}>
                {fmtQuantity(impact.quantity)}
              </span>
              <span className="text-label" style={{ color: C.sub }}>
                {impact.unit && lowerFirst(impact.unit)}
                {impact.comparison && (
                  <>
                    {impact.unit && ' · '}
                    <span style={{ color: impact.comparison.ahead ? C.brand : C.sub }}>
                      {impact.comparison.text}
                    </span>
                  </>
                )}
              </span>
            </p>
          ) : (
            <p className="font-display text-label" style={{ color: C.sub }}>
              {analysed ? 'No quantity evidenced in this report' : 'No impact figure yet'}
            </p>
          )}
        </div>
      </Boundary>
    </div>
  )
}

/**
 * A one-line footnote to the summary: the main challenge, or the main lesson. The model is
 * asked for a single short line, so this is one line nearly always. Reports analysed
 * before that instruction carry a paragraph, which folds to two lines behind a chevron
 * rather than growing the card.
 */
function DigestLine({ label, text }: { label: string; text: string }) {
  const clamp = useClamp(text, 2)
  return (
    <div className="flex items-start gap-2">
      <p
        ref={clamp.ref}
        className={`min-w-0 flex-1 font-display text-body leading-normal ${clamp.className ?? ''}`}
        style={{ color: C.body }}
      >
        <span className="font-medium" style={{ color: C.ink }}>
          {label}:
        </span>{' '}
        {text}
      </p>
      {(clamp.clipped || clamp.open) && (
        <ClampToggle
          open={clamp.open}
          onToggle={clamp.toggle}
          label={`Read the full ${label.toLowerCase()}`}
        />
      )}
    </div>
  )
}

/** "Households" → "households", without flattening a foundation's own capitals — see
 *  `impactPhrase` in `lib/impactUnits`. */
function lowerFirst(label: string) {
  return label.charAt(0).toLowerCase() + label.slice(1)
}

/** One alignment as a card: the question, the model's 1–10 answer, and its reasoning. */
function AlignmentCard({
  title,
  score,
  narrative,
}: {
  title: string
  score: number
  narrative: string
}) {
  return (
    <Panel label={title} className="flex flex-col gap-4">
      <CardHead
        title={title}
        right={<ScoreChip colour={bandForScore(score, 10).text}>{score}/10</ScoreChip>}
      />
      <p className="font-display text-body leading-normal" style={{ color: C.body }}>
        {narrative}
      </p>
    </Panel>
  )
}

/** The two alignments, side by side where there is room for two paragraphs. */
export function AlignmentCards({ analysis }: { analysis: ReportAnalysisData }) {
  const { applicationAlignment: app, programmeAlignment: prog } = analysis
  if (!app && !prog) return null
  return (
    <div className={`grid gap-4 ${app && prog ? 'md:grid-cols-2' : ''}`}>
      {app && (
        <AlignmentCard title="Application alignment" score={app.score} narrative={app.narrative} />
      )}
      {prog && (
        <AlignmentCard title="Programme alignment" score={prog.score} narrative={prog.narrative} />
      )}
    </div>
  )
}

/** The marker a promise wears — met, or not shown to be: the design's own two icons
 *  (Figma 1274:359 / 1274:380), so "met" and "not met" differ by shape as well as hue. */
function PromiseMark({ kept }: { kept: boolean }) {
  return (
    <img
      src={kept ? promiseMetIcon : promiseUnmetIcon}
      alt={kept ? 'Met' : 'Not met'}
      className="mt-px size-4 shrink-0"
    />
  )
}

/** What the application said the charity would do, checked against this report. */
export function PromisesCard({ analysis }: { analysis: ReportAnalysisData }) {
  const kept = analysis.applicationAlignment?.promisesKept ?? []
  const unmet = analysis.applicationAlignment?.promisesUnmet ?? []
  const total = kept.length + unmet.length
  if (total === 0) return null
  return (
    <Panel label="Application objectives" className="flex flex-col gap-4">
      <CardHead
        title="Application objectives"
        sub="What the charity said they would do in the original funding application, checked against this report."
        right={
          <ScoreChip colour={bandForScore((kept.length / total) * 10, 10).text}>
            {kept.length} of {total} met
          </ScoreChip>
        }
      />
      <ul className="flex flex-col gap-4">
        {kept.map((p, i) => (
          <li key={`kept-${i}`} className="flex items-start gap-2">
            <PromiseMark kept />
            <span className="font-display text-label font-medium" style={{ color: C.ink }}>
              {p}
            </span>
          </li>
        ))}
        {unmet.map((p, i) => (
          <li key={`unmet-${i}`} className="flex items-start gap-2">
            <PromiseMark kept={false} />
            <span className="font-display text-label font-medium" style={{ color: C.ink }}>
              {p}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * Observations for a reviewer. Always drawn once there is an analysis: "nothing was
 * flagged" is something the screen says, not something a reader infers from a card that
 * isn't there. No count beside the title — the list is short and is its own count.
 */
export function FlagsCard({ flags }: { flags: string[] }) {
  return (
    <Panel label="Flags for your review" className="flex flex-col gap-4">
      <CardHead
        title="Flags for your review"
        sub="Observations against the whole submission, for a reviewer to judge. Not pass or fail."
      />
      {flags.length === 0 ? (
        <p className="font-display text-label" style={{ color: C.sub }}>
          Nothing was flagged in this report.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {flags.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-chip border p-3"
              style={{
                backgroundColor: `color-mix(in srgb, ${C.danger} 5%, transparent)`,
                borderColor: `color-mix(in srgb, ${C.danger} 20%, transparent)`,
              }}
            >
              <HugeiconsIcon icon={Alert02Icon} size={16} color={C.danger} className="shrink-0" />
              <span className="font-display text-label font-medium" style={{ color: C.ink }}>
                {f}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** One alignment as a bar under its label, for the side column's summary. */
function AlignmentBar({ label, score }: { label: string; score: number }) {
  const band = bandForScore(score, 10)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 font-display text-label font-medium">
        <span style={{ color: C.ink }}>{label}</span>
        <span className="tabular-nums" style={{ color: C.sub }}>
          {score}/10
        </span>
      </div>
      <ProgressBar
        value={score / 10}
        colour={band.fill}
        track={`color-mix(in srgb, ${band.fill} 20%, transparent)`}
        height={6}
      />
    </div>
  )
}

/**
 * The report's one headline score: the mean of the two alignments it has. There is no
 * third input and no weighting — the two questions ("did they do what they said" and
 * "did it serve the programme") are the whole judgement, and inventing a weight between
 * them would be a claim the model never made. With one alignment the mean is that one;
 * with neither there is no card.
 */
export function AlignmentSummary({ analysis }: { analysis: ReportAnalysisData }) {
  const app = analysis.applicationAlignment?.score
  const prog = analysis.programmeAlignment?.score
  const scores = [app, prog].filter((n): n is number => typeof n === 'number')
  if (scores.length === 0) return null
  const overall = scores.reduce((t, n) => t + n, 0) / scores.length

  return (
    <Panel label="Alignment" className="flex flex-col gap-4">
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        Alignment
      </h2>
      <div className="flex items-center gap-3">
        {/* The same ring the application detail draws its Custodian score in, banded by
            the same rule. Quoted out of 10 because its parts are: an alignment is a
            criterion, and a criterion is never restated on the composite's scale. */}
        <ScoreRing score={overall} outOf={10} size={88} thickness={8} decimals={1} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {app != null && <AlignmentBar label="Vs application" score={app} />}
          {prog != null && <AlignmentBar label="Vs programme" score={prog} />}
        </div>
      </div>
    </Panel>
  )
}
