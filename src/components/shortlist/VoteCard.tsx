import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  ClipboardCheckIcon,
  Message01Icon,
} from '@hugeicons/core-free-icons'
import { castVote } from '../../server/fns/comments'
import { CRITERION_DEFINITIONS, type CustodianScoreDetail } from '../../lib/custodianScore'
import type { DeprivationResult } from '../../lib/deprivation/types'
import { impactUnitLabel } from '../../lib/impactUnits'
import { fmtMoney, fmtRef } from '../../lib/format'
import { Avatar, ErrorNote, TextLink, initials } from '../ui'
import { useAnchoredPopover, useDismiss } from '../ui/popover'
import { C, bandForScore } from '../ui/tokens'
import { withAlpha } from '../BarMeter'
import { CommentsDialog } from './CommentsDialog'

export type ShortlistTrustee = { id: string; name: string; image: string | null }

/** The order the criteria read in — the registry's own order. */
const CRITERION_KEYS = Object.keys(CRITERION_DEFINITIONS) as Array<
  keyof typeof CRITERION_DEFINITIONS
>

export type VoteCardApplication = {
  id: string
  organisationName: string
  amountRequested: string
  externalApplicationId: string | null
  charityNumber: string | null
  companyNumber: string | null
  deliveryArea: string | null
  deliveryRegion: string | null
  custodianScore: number | null
  custodianScoreDetail: CustodianScoreDetail | null
  custodianScoreStatus: string
  grantPurpose: string | null
  deprivationContext: DeprivationResult | null
  dueDiligenceStatus: string
  proposedImpactQuantity: string | null
  roundProgramme: {
    grantDurationYears: number | null
    programme: { name: string; impactUnit: string | null; impactUnitLabel: string | null } | null
    round: { name: string } | null
  } | null
  votes: Array<{ userId: string; vote: 'yes' | 'no' }>
  yesVotes: number
  noVotes: number
  trusteeCount: number
  hasMajority: boolean
  oneVoteShort: boolean
  commentCount: number
}

/**
 * Yes-votes still needed to carry it. The board's question is never "how many have
 * voted" but "how far off is this" — and one away is a different sentence from three
 * away, which is why the pill says the number rather than "awaiting votes".
 */
function votesStillNeeded(app: VoteCardApplication): number {
  if (app.trusteeCount === 0) return 0
  return Math.max(0, Math.floor(app.trusteeCount / 2) + 1 - app.yesVotes)
}

function Pill({
  tone,
  children,
}: {
  tone: 'brand' | 'amber' | 'grey' | 'danger'
  children: React.ReactNode
}) {
  const style =
    tone === 'brand'
      ? { backgroundColor: C.brandBg, color: C.brand }
      : tone === 'amber'
        ? { backgroundColor: C.amberWash, color: C.amber }
        : tone === 'danger'
          ? { backgroundColor: C.dangerWash, color: C.danger }
          : { backgroundColor: C.wash, color: C.sub }
  return (
    <span
      className="whitespace-nowrap rounded-pill px-2.5 py-1 font-display text-label font-medium"
      style={style}
    >
      {children}
    </span>
  )
}

function DecisionPill({ app }: { app: VoteCardApplication }) {
  if (app.hasMajority) return <Pill tone="brand">Board approved</Pill>
  const needed = votesStillNeeded(app)
  if (app.trusteeCount === 0) return <Pill tone="amber">No trustees to vote</Pill>
  if (needed === 1) return <Pill tone="amber">Last vote needed</Pill>
  return <Pill tone="grey">{needed} votes needed</Pill>
}

/**
 * How a trustee voted, in the past tense — this is a record, not an instruction.
 * Pending is amber rather than grey (Figma 765:9565): a vote nobody has cast is the one
 * thing on the roster still to happen, and grey reads as "nothing to see here".
 */
function VotePill({ vote }: { vote: 'yes' | 'no' | undefined }) {
  const [label, fg, bg] =
    vote === 'yes'
      ? (['Approved', C.brand, C.brandBg] as const)
      : vote === 'no'
        ? (['Declined', C.danger, C.dangerWash] as const)
        : (['Pending', C.amber, C.amberWash] as const)
  // The small pill (10px): this annotates one trustee in the roster, so it must not
  // compete with the DecisionPill above it, which is the card's actual status.
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2"
      style={{ backgroundColor: bg }}
    >
      <span className="size-[3px] rounded-full" style={{ backgroundColor: fg }} />
      <span className="font-display text-micro font-medium" style={{ color: fg }}>
        {label}
      </span>
    </span>
  )
}

/**
 * The admin's way in to a trustee's vote (Figma 827:1757): a marker beside the roster row
 * that opens Approve / Decline for that named person.
 *
 * It replaced a bare ✓/✗ pair sitting inline on the row, which said nothing about whose
 * vote it was recording — the one thing an admin must be sure of before pressing it. The
 * panel names them; the buttons carry their own words.
 *
 * It is offered on EVERY row, not just the ones still pending, because a vote read out at
 * a meeting and typed in wrong is exactly the kind of mistake that has to be correctable
 * — `castVote` upserts, so the server has always allowed it.
 */
function OnBehalfControl({
  trustee,
  vote,
  busy,
  onVote,
}: {
  trustee: ShortlistTrustee
  vote: 'yes' | 'no' | undefined
  busy: boolean
  onVote: (vote: 'yes' | 'no') => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pos = useAnchoredPopover(open, rootRef, panelRef)

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }
  useDismiss(open, close, rootRef, panelRef)

  return (
    <span ref={rootRef} className="relative flex shrink-0 items-center print:hidden">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Record ${trustee.name}’s vote on their behalf`}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex size-6 items-center justify-center rounded-chip hover:bg-grey-100 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
      >
        <HugeiconsIcon icon={ClipboardCheckIcon} size={16} color={C.brand} strokeWidth={1.8} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`${trustee.name}’s vote`}
            className="fixed z-[60] w-[268px] rounded-card border bg-white p-3 shadow-[0px_11px_24px_rgba(0,0,0,0.1),0px_43px_43px_rgba(0,0,0,0.09)]"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              borderColor: C.line,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            <p className="font-display text-label" style={{ color: C.ink }}>
              {trustee.name}’s vote on their behalf
            </p>
            {/* What is on record already, said in words — a vote typed in wrong at a
                meeting is corrected here, and the admin has to be able to see what they
                are correcting. */}
            {vote !== undefined && (
              <p className="mt-0.5 font-display text-label" style={{ color: C.sub }}>
                Recorded as {vote === 'yes' ? 'approved' : 'declined'}.
              </p>
            )}
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                aria-pressed={vote === 'yes'}
                onClick={() => {
                  onVote('yes')
                  close()
                }}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-control font-display text-body font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: C.brand }}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} strokeWidth={1.8} />
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                aria-pressed={vote === 'no'}
                onClick={() => {
                  onVote('no')
                  close()
                }}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-control border bg-white font-display text-body font-medium transition-colors hover:bg-grey-50 disabled:opacity-50"
                style={{ borderColor: C.line, color: C.danger }}
              >
                <HugeiconsIcon icon={CancelCircleIcon} size={16} strokeWidth={1.8} />
                Decline
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}

// The scale every screen states the score on: the composite out of 100, each criterion
// out of 10, with the same RAG bands behind both — `scoreBand` in `ui/tokens` owns the
// thresholds. The comps drew the composite as `9.1/10`; two screens quoting one score on
// two scales is how a board ends up arguing about the number instead of the application.

/**
 * The composite, as the comp draws it (Figma 765:3407): a brand-tinted panel with the
 * label above the figure, and a dot texture over its right-hand half.
 *
 * The GROUND is the brand, always — it is the panel's identity, not a readout, so it does
 * not move with the score. Only the figure carries the RAG band, which is the same
 * division the applications list makes (a coloured meter, a plain number beside it) read
 * the other way round.
 *
 * The dots are the dashboard KPI card's trick exactly: a radial GRADIENT is the fill and
 * the dot grid is only a mask, so the field is densest at its middle and dissolves at its
 * own edges. Drawn as flat dots at a uniform alpha it read as a texture someone had
 * clipped in half — the comp's field has no edge anywhere, which is what lets it sit
 * behind the figure without competing with it. Inset on the right rather than bled to the
 * tile's edges, for the same reason: a field that runs off the card has an edge again.
 */
function ScoreTile({ score }: { score: number }) {
  const band = bandForScore(score)
  return (
    <div
      className="relative flex h-[74px] w-full shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-card sm:w-[132px]"
      style={{ backgroundColor: C.brandBg }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute right-[7%] top-1/2 aspect-square h-[86%] -translate-y-1/2"
        style={{
          backgroundImage: `radial-gradient(50% 50% at 50% 50%, ${withAlpha(C.brand, 0.22)} 0%, ${withAlpha(C.brand, 0)} 100%)`,
          WebkitMaskImage: 'radial-gradient(circle, #000 1px, transparent 1.1px)',
          maskImage: 'radial-gradient(circle, #000 1px, transparent 1.1px)',
          WebkitMaskSize: '7px 7px',
          maskSize: '7px 7px',
        }}
      />
      <span className="relative font-display text-label" style={{ color: C.brand }}>
        AI score
      </span>
      <span className="relative flex items-baseline gap-1">
        <span
          className="font-display text-heading font-medium leading-none"
          style={{ color: band.text }}
        >
          {score}
        </span>
        <span className="font-display text-label" style={{ color: withAlpha(C.brand, 0.5) }}>
          /100
        </span>
      </span>
    </div>
  )
}

function CriterionBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span
        className="w-[104px] shrink-0 truncate font-display text-label"
        style={{ color: C.sub }}
      >
        {label}
      </span>
      <span
        className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full"
        style={{ backgroundColor: C.wash }}
      >
        <span
          className="block h-full rounded-full"
          style={{
            width: `${(score ?? 0) * 10}%`,
            backgroundColor: score === null ? C.wash : bandForScore(score, 10).fill,
          }}
        />
      </span>
      <span
        className="w-8 shrink-0 text-right font-display text-label tabular-nums"
        style={{ color: C.sub }}
      >
        {score === null ? '—' : `${score}/10`}
      </span>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display text-label font-medium" style={{ color: C.brand }}>
      {children}
    </div>
  )
}

/**
 * One shortlisted application, as a board member meets it (Figma 765:3270): what is
 * being asked for, what the model made of it, and where the vote stands — with the vote
 * controls in the same card, so deciding never means leaving the list.
 */
export function VoteCard({
  app,
  trustees,
  userId,
  userRole,
  allowAdminVoting,
}: {
  app: VoteCardApplication
  trustees: ShortlistTrustee[]
  userId: string
  userRole: string
  allowAdminVoting: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showComments, setShowComments] = useState(false)
  const [changing, setChanging] = useState(false)

  const isTrustee = userRole === 'trustee'
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'
  // An admin has no vote of their own (see `castVote`) — they may only record one on a
  // named trustee's behalf, and only when the foundation has switched that on. So the
  // two roles get different controls: a trustee gets the decision buttons, an admin
  // gets a per-trustee toggle in the roster.
  const canVoteAsSelf = isTrustee
  const canVoteForTrustees = isAdmin && allowAdminVoting

  const voteMap = new Map(app.votes.map((v) => [v.userId, v.vote]))
  const myVote = voteMap.get(userId)
  const detail = app.custodianScoreDetail
  const scored = app.custodianScoreStatus === 'scored' && app.custodianScore !== null
  const programme = app.roundProgramme?.programme
  const amount = parseFloat(app.amountRequested)
  const years = app.roundProgramme?.grantDurationYears ?? null

  const unitLabel = impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel)
  const impact = app.proposedImpactQuantity ? Number(app.proposedImpactQuantity) : null
  const costPerUnit = impact && impact > 0 ? amount / impact : null

  // Narrow on the payload's own discriminant rather than the denormalised status
  // column, so the fields we read are guaranteed present by the type.
  const deprivation = app.deprivationContext?.status === 'resolved' ? app.deprivationContext : null
  const subline = [app.deliveryRegion ?? app.deliveryArea, fmtRef(app.externalApplicationId)]
    .filter(Boolean)
    .join(' · ')

  const flags = detail?.flags ?? []

  // The comps drop due diligence from this card entirely, which is right while it is
  // clear and wrong the moment it is not: a board must not approve a grant to a charity
  // the registry flagged without the flag being on the screen they approve it from. So
  // it appears in the meta strip only when it has something to say.
  const ddNote =
    app.dueDiligenceStatus === 'warning'
      ? 'Due diligence warnings'
      : app.dueDiligenceStatus === 'blocked'
        ? 'Due diligence blocked'
        : app.dueDiligenceStatus === 'review'
          ? 'Due diligence needs a manual check'
          : app.dueDiligenceStatus === 'no_registration'
            ? // Said plainly rather than as "not run": the board is about to vote, and
              // "no register to check" is a fact about the applicant they should weigh,
              // not a job somebody forgot to do.
              'No charity or company number — not screened'
            : app.dueDiligenceStatus === 'pending'
              ? 'Due diligence not run'
              : null

  // Figure and unit are separated so the figure can carry the weight (Figma 765:3377):
  // what a board scans this strip for is the numbers, not the words between them.
  const meta = [
    impact !== null
      ? { value: impact.toLocaleString('en-GB'), label: unitLabel.toLowerCase() }
      : null,
    costPerUnit !== null ? { value: fmtMoney(costPerUnit), label: 'each' } : null,
    deprivation ? { value: `IMD decile ${deprivation.min}–${deprivation.max}`, label: '' } : null,
  ].filter((m) => m !== null)

  async function handleVote(vote: 'yes' | 'no', onBehalfOf?: string) {
    setBusy(true)
    setError(null)
    try {
      await castVote({ data: { applicationId: app.id, vote, onBehalfOf } })
      setChanging(false)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your vote')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card border bg-white" style={{ borderColor: C.line }}>
      <div className="flex flex-col lg:flex-row">
        {/* ── The application ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
          <div className="flex items-start gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-chip"
              style={{ backgroundColor: C.wash }}
            >
              <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
                {initials(app.organisationName)}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  to="/applications/$applicationId"
                  params={{ applicationId: app.id }}
                  className="font-display text-title font-medium hover:underline"
                  style={{ color: C.ink }}
                >
                  {app.organisationName}
                </Link>
                <span className="truncate font-display text-label" style={{ color: C.sub }}>
                  {subline}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {programme?.name && <Pill tone="grey">{programme.name}</Pill>}
                <DecisionPill app={app} />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display text-heading font-medium" style={{ color: C.ink }}>
                {fmtMoney(amount)}
              </div>
              <div className="font-display text-label" style={{ color: C.faint }}>
                {years && years > 1
                  ? `${fmtMoney(amount / years)} per year for ${years}yrs`
                  : 'requested'}
              </div>
            </div>
          </div>

          {app.grantPurpose && (
            <div>
              <SectionLabel>Grant purpose</SectionLabel>
              <p className="mt-1 font-display text-body leading-relaxed" style={{ color: C.body }}>
                {app.grantPurpose}
              </p>
            </div>
          )}

          {detail?.summary && (
            <div>
              <SectionLabel>AI assessment</SectionLabel>
              <p
                className="mt-1 border-l-2 pl-3 font-display text-body leading-relaxed"
                style={{ color: C.body, borderColor: C.brand }}
              >
                {detail.summary}
              </p>
            </div>
          )}

          {flags.length > 0 && (
            <div className="rounded-control px-3.5 py-2.5" style={{ backgroundColor: C.amberWash }}>
              <div className="flex items-center gap-1.5">
                <HugeiconsIcon icon={Alert02Icon} size={14} color={C.amber} strokeWidth={1.8} />
                <span className="font-display text-label font-medium" style={{ color: C.amber }}>
                  {flags.length === 1 ? 'One thing to check' : `${flags.length} things to check`}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {flags.map((f, i) => (
                  <li
                    key={i}
                    className="font-display text-label leading-relaxed"
                    style={{ color: C.amber }}
                  >
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {scored && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <ScoreTile score={app.custodianScore!} />
              {/* Two explicit columns rather than a wrapping grid, so the rule between
                  them lands between the columns and not down the middle of a row. */}
              <div className="grid min-w-0 flex-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {[
                  CRITERION_KEYS.slice(0, Math.ceil(CRITERION_KEYS.length / 2)),
                  CRITERION_KEYS.slice(Math.ceil(CRITERION_KEYS.length / 2)),
                ].map((column, i) => (
                  <div
                    key={i}
                    className="flex min-w-0 flex-col gap-2 sm:last:border-l sm:last:pl-6"
                    style={{ borderColor: C.line }}
                  >
                    {column.map((key) => (
                      <CriterionBar
                        key={key}
                        label={CRITERION_DEFINITIONS[key].label}
                        score={detail?.criteria?.[key]?.score ?? null}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(meta.length > 0 || ddNote) && (
            <div className="border-t pt-3" style={{ borderColor: C.line }}>
              <p className="font-display text-label" style={{ color: C.sub }}>
                {meta.map((m, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    <span style={{ color: C.ink }}>{m.value}</span>
                    {m.label && ` ${m.label}`}
                  </span>
                ))}
                {ddNote && (
                  <>
                    {meta.length > 0 && ' · '}
                    <span style={{ color: C.amber }}>{ddNote}</span>
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {/* ── The vote ── */}
        {/* White, divided by a rule rather than sat on a washed panel (Figma 765:9565):
            the roster's own pills are what carry colour here, and a tinted ground behind
            them muddies the one thing the column is for. */}
        <div
          className="flex w-full flex-col gap-3 border-t p-4 lg:w-[300px] lg:shrink-0 lg:border-t-0 lg:border-l"
          style={{ borderColor: C.line }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-body font-medium" style={{ color: C.ink }}>
              Board votes
            </span>
            <span className="font-display text-label" style={{ color: C.sub }}>
              {app.votes.length} of {app.trusteeCount} voted
            </span>
          </div>

          {trustees.length === 0 ? (
            <p className="font-display text-label leading-relaxed" style={{ color: C.sub }}>
              No trustees have been added yet, so nothing can be approved.{' '}
              <Link
                to="/settings/team"
                className="font-medium hover:underline"
                style={{ color: C.brand }}
              >
                Invite trustees
              </Link>
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {trustees.map((t) => {
                const vote = voteMap.get(t.id)
                return (
                  <div key={t.id} className="flex items-center gap-2">
                    <Avatar name={t.name} image={t.image} size={20} />
                    <span
                      className="min-w-0 flex-1 truncate font-display text-label"
                      style={{ color: C.ink, fontWeight: t.id === userId ? 600 : 400 }}
                    >
                      {t.name}
                      {t.id === userId && <span style={{ color: C.faint }}> (You)</span>}
                    </span>
                    {canVoteForTrustees && (
                      <OnBehalfControl
                        trustee={t}
                        vote={vote}
                        busy={busy}
                        onVote={(v) => handleVote(v, t.id)}
                      />
                    )}
                    <VotePill vote={vote} />
                  </div>
                )
              })}
            </div>
          )}

          {/* The comps put a bare comment box here. It is replaced by the count, which
              opens the thread — see `CommentsDialog` on why writing into a discussion
              you cannot read is the one thing this control must not be. */}
          <button
            type="button"
            onClick={() => setShowComments(true)}
            className="flex h-8 items-center justify-center gap-1.5 rounded-control border bg-white font-display text-label font-medium transition-colors hover:bg-grey-50 print:hidden"
            style={{ borderColor: C.line, color: C.ink }}
          >
            <HugeiconsIcon icon={Message01Icon} size={14} color={C.sub} strokeWidth={1.8} />
            {app.commentCount === 0
              ? 'Add a comment'
              : `${app.commentCount} comment${app.commentCount === 1 ? '' : 's'}`}
          </button>

          {canVoteAsSelf && (myVote === undefined || changing) && (
            <div className="flex flex-col gap-2 print:hidden">
              <button
                type="button"
                onClick={() => handleVote('yes')}
                disabled={busy}
                className="flex h-10 items-center justify-center gap-1.5 rounded-control font-display text-body font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: C.brand }}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} strokeWidth={1.8} />
                Approve
              </button>
              <button
                type="button"
                onClick={() => handleVote('no')}
                disabled={busy}
                className="flex h-10 items-center justify-center gap-1.5 rounded-control border bg-white font-display text-body font-medium transition-colors hover:bg-grey-50 disabled:opacity-50"
                style={{ borderColor: C.line, color: C.danger }}
              >
                <HugeiconsIcon icon={CancelCircleIcon} size={16} strokeWidth={1.8} />
                Decline
              </button>
            </div>
          )}

          {canVoteAsSelf && myVote !== undefined && !changing && (
            <div
              className="flex flex-col items-center gap-1 rounded-control py-3"
              style={{ backgroundColor: myVote === 'yes' ? C.brandBg : C.dangerWash }}
            >
              <span
                className="flex items-center gap-1.5 font-display text-label font-medium"
                style={{ color: myVote === 'yes' ? C.brand : C.danger }}
              >
                <HugeiconsIcon
                  icon={myVote === 'yes' ? CheckmarkCircle02Icon : CancelCircleIcon}
                  size={14}
                  strokeWidth={1.8}
                />
                You {myVote === 'yes' ? 'approved' : 'declined'} this application
              </span>
              <button
                type="button"
                onClick={() => setChanging(true)}
                className="font-display text-label font-medium underline"
                style={{ color: myVote === 'yes' ? C.brand : C.danger }}
              >
                Change vote
              </button>
            </div>
          )}

          {canVoteForTrustees && (
            <p className="font-display text-label leading-snug" style={{ color: C.sub }}>
              You are recording votes on trustees’ behalf.
            </p>
          )}

          <ErrorNote error={error} />

          {/* The way off this card and onto the whole application, so it is the card's
              own body size (14px) rather than the 12px meta scale everything else in
              this column wears — it was reading as a footnote. No trailing arrow: the
              app draws direction with a Hugeicons chevron on a control, never as a
              glyph inside a sentence, and this was the only "→" in any copy. */}
          <TextLink
            to="/applications/$applicationId"
            params={{ applicationId: app.id }}
            className="mt-auto pt-1 text-center text-body"
          >
            View Application details →
          </TextLink>
        </div>
      </div>

      {showComments && (
        <CommentsDialog
          applicationId={app.id}
          organisationName={app.organisationName}
          onClose={() => setShowComments(false)}
          onChanged={() => router.invalidate()}
        />
      )}
    </div>
  )
}
