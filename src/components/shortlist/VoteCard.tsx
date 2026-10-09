import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  ClipboardCheckIcon,
  HistoryIcon,
  Message01Icon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons'
import { castVote } from '../../server/fns/comments'
import { CRITERION_DEFINITIONS, type CustodianScoreDetail } from '../../lib/custodianScore'
import type { DeprivationResult } from '../../lib/deprivation/types'
import type { OrganisationProfile } from '../../lib/dueDiligence/types'
import { deliveryAreaLabel, formatDecileRange } from '../../lib/deprivation/types'
import { impactUnitLabel } from '../../lib/impactUnits'
import { fmtExact, fmtMoney, fmtPerYear, fmtSince } from '../../lib/format'
import { Avatar, ErrorNote, TextLink, initials, useClamp } from '../ui'
import { POPOVER_LAYER, useAnchoredPopover, useDismiss } from '../ui/popover'
import { C, bandForScore } from '../ui/tokens'
import { majorityOf } from '../../lib/voting'
import { withAlpha } from '../BarMeter'
import { CommentsDialog } from './CommentsDialog'
import { decidedAmount } from '../../lib/amountRequested'
import { setAmendedAmount } from '../../server/fns/applications'
import { AmountDialog } from '../AmountDialog'

/**
 * One member of the voting board: every current trustee, plus any admin the foundation
 * has given a vote. `role` is carried so the roster can say which is which — a board
 * reading "4 of 5 voted" is entitled to know that one of the five is the administrator.
 */
export type ShortlistVoter = {
  id: string
  name: string
  image: string | null
  role: string
}

/** The order the criteria read in — the registry's own order. */
const CRITERION_KEYS = Object.keys(CRITERION_DEFINITIONS) as Array<
  keyof typeof CRITERION_DEFINITIONS
>

export type VoteCardApplication = {
  id: string
  organisationName: string
  /** The applicant's own description; the register's `activities` stands in for it. */
  organisationSummary: string | null
  amountRequested: string | null
  charityNumber: string | null
  companyNumber: string | null
  deliveryArea: string | null
  deliveryRegion: string | null
  deliveryLadName: string | null
  custodianScore: number | null
  custodianScoreDetail: CustodianScoreDetail | null
  custodianScoreStatus: string
  grantPurpose: string | null
  deprivationContext: DeprivationResult | null
  dueDiligenceStatus: string
  proposedImpactQuantity: string | null
  /** The applicant's own figure, from the form. The only source there is for it. */
  unrestrictedReserves: string | null
  /** The applicant's stated income, which the card prints before the register's. */
  organisationIncome: string | null
  /** The register's filed figures; `latestIncome` is the fallback for income. */
  organisationProfile: OrganisationProfile | null
  /** What this grant draws from the round this financial year — resolved server-side, of
   *  the proposed amount where there is one. */
  firstYearAmount: number
  firstYearIsSuggested: boolean
  /** An officer's proposal (`applications.amount_amended`), or null = the ask. */
  amountAmended: string | null
  /** The amount that would be awarded: the proposal, else the ask. */
  effectiveAmount: number
  /** Votes by the current board cast before the amount last changed. They stand. */
  votesBeforeChange: number
  roundProgramme: {
    grantDurationYears: number | null
    programme: { name: string; impactUnit: string | null; impactUnitLabel: string | null } | null
    round: { name: string } | null
  } | null
  votes: Array<{ userId: string; vote: 'yes' | 'no'; recordedByUserId?: string | null }>
  yesVotes: number
  noVotes: number
  voterCount: number
  hasMajority: boolean
  oneVoteShort: boolean
  commentCount: number
  /** The newest remark, previewed above the split button; null = no discussion yet. */
  latestComment: {
    body: string
    createdAt: string | Date
    user: { id: string; name: string; image: string | null }
  } | null
  /** What `applicationActivity` would list for a trustee: no comments, no money. */
  activityCount: number
}

/**
 * The card's own count of where the vote stands.
 *
 * Derived here rather than read off the row, because `app.yesVotes` and
 * `app.hasMajority` were computed by the server for the votes it knew about — and for
 * a moment after you vote, this card knows about one more. See `Tally` below.
 */
type Tally = { voterCount: number; voted: number; yesVotes: number; hasMajority: boolean }

/**
 * Yes-votes still needed to carry it. The board's question is never "how many have
 * voted" but "how far off is this" — and one away is a different sentence from three
 * away, which is why the pill says the number rather than "awaiting votes".
 */
function votesStillNeeded(tally: Tally): number {
  return Math.max(0, majorityOf(tally.voterCount) - tally.yesVotes)
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

function DecisionPill({ tally }: { tally: Tally }) {
  if (tally.hasMajority) return <Pill tone="brand">Board approved</Pill>
  const needed = votesStillNeeded(tally)
  if (tally.voterCount === 0) return <Pill tone="amber">Nobody can vote</Pill>
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
  trustee: ShortlistVoter
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
            {...POPOVER_LAYER}
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
        {score === null ? '--' : `${score}/10`}
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
 * A section of the card's prose, painted three lines deep (`useClamp`). Ten cards of
 * full answers was most of the screen; a trustee reads three lines of each and opens the
 * one they are unsure about. The HEADING is the control, its chevron right beside the
 * word: the chevron this replaced sat at the far end of the heading line, a long way from
 * where reading starts, and was missed. The text opens it too, for the mouse. Unclamped
 * on paper, where there is nothing to press.
 */
function ClampedSection({
  label,
  text,
  toggleLabel,
  assessment = false,
}: {
  label: string
  text: string
  toggleLabel: string
  /** The AI's words, set off by the brand rule as before. */
  assessment?: boolean
}) {
  const clamp = useClamp(text, 3)
  const expandable = clamp.clipped || clamp.open
  return (
    <div>
      {expandable ? (
        <button
          type="button"
          onClick={clamp.toggle}
          aria-expanded={clamp.open}
          title={clamp.open ? 'Show less' : toggleLabel}
          className="flex items-center gap-1 font-display text-label font-medium hover:underline print:pointer-events-none"
          style={{ color: C.brand }}
        >
          {label}
          <span className="print:hidden">
            <HugeiconsIcon
              icon={clamp.open ? ArrowUp01Icon : ArrowDown01Icon}
              size={14}
              strokeWidth={1.8}
            />
          </span>
        </button>
      ) : (
        <SectionLabel>{label}</SectionLabel>
      )}
      {/* A click that ends a text selection is somebody copying a line, not asking to
          toggle. */}
      <p
        ref={clamp.ref}
        onClick={
          expandable
            ? () => {
                if (window.getSelection()?.toString()) return
                clamp.toggle()
              }
            : undefined
        }
        className={`mt-1 font-display text-body leading-relaxed whitespace-pre-line print:line-clamp-none ${
          assessment ? 'border-l-2 pl-3' : ''
        } ${expandable ? 'cursor-pointer' : ''} ${clamp.className ?? ''}`}
        style={{ color: C.body, borderColor: assessment ? C.brand : undefined }}
      >
        {text}
      </p>
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
  voters,
  userId,
  userRole,
  iVote,
  allowAdminVoting,
  amountContext,
  programmeColour,
}: {
  app: VoteCardApplication
  /** The programme's own colour, as the Proposed spend panel above the cards draws it. */
  programmeColour?: string
  voters: ShortlistVoter[]
  userId: string
  userRole: string
  /** Does the signed-in user hold a vote of their own? `holdsAVote`, resolved by the route. */
  iVote: boolean
  allowAdminVoting: boolean
  /** What the amount dialog needs from the screen: the year, the ceiling, what is left. */
  amountContext: {
    financialYearLabel: string
    enforced: boolean
    budgetRemaining: number | null
  }
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showComments, setShowComments] = useState<'comments' | 'activity' | null>(null)
  const [changing, setChanging] = useState(false)
  const [editingAmount, setEditingAmount] = useState(false)
  // Closed until asked for: a card is read for the ask, the assessment and the vote, and
  // a list of caveats open on every one of ten cards is most of the screen.
  const [flagsOpen, setFlagsOpen] = useState(false)
  const [justCast, setJustCast] = useState<
    Record<string, { vote: 'yes' | 'no'; proxied: boolean }>
  >({})

  // Let go of a held vote the moment the loader agrees with it, so that from then on the
  // row is the only source. Without this, a later correction made elsewhere — an admin
  // fixing a vote read out wrong at the meeting — would arrive and be painted over by
  // what this card happened to submit earlier.
  useEffect(() => {
    setJustCast((held) => {
      const server = new Map(app.votes.map((v) => [v.userId, v.vote]))
      const settled = Object.keys(held).filter((id) => server.get(id) === held[id]!.vote)
      if (settled.length === 0) return held
      const next = { ...held }
      for (const id of settled) delete next[id]
      return next
    })
  }, [app.votes])

  const isAdmin = userRole === 'admin' || userRole === 'superadmin'
  // The two controls are independent, and an admin can have both. Voting as yourself
  // needs a vote of your own — always true of a trustee, true of an admin the foundation
  // has given one. Recording somebody else's needs the foundation to allow proxies, and
  // is an admin power whether or not they sit on the board themselves. An admin with
  // both gets the decision buttons for their own vote AND a toggle beside each trustee;
  // their own row in the roster gets no toggle, because voting on your own behalf is
  // just voting (see `castVote`, where it leaves `recordedByUserId` null).
  const canVoteAsSelf = iVote
  const canVoteForTrustees = isAdmin && allowAdminVoting
  // Officers amend the figure; trustees say what they think of it in the discussion.
  const canPropose = isAdmin && app.amountRequested !== null

  // Votes cast from this card that the server has ACCEPTED but the loader has not
  // brought back yet. `castVote` resolving is the vote being true; `router.invalidate()`
  // is a second round trip on top of that, and on staging it lands 100ms–2.5s later.
  // Until this existed the card spent that gap stating the OLD vote as settled fact —
  // `setChanging(false)` had already closed the Approve / Decline pair, so a trustee who
  // had just pressed Decline was told "You approved this application" with an Approved
  // pill beside their name. Not optimism: the server has already said yes.
  const voteMap = new Map(app.votes.map((v) => [v.userId, v.vote]))
  // Whose vote was entered by somebody else. Recording the proxy is only half the fix —
  // if the roster draws it identically to a vote the trustee cast, the board reading
  // the roster still cannot tell the two apart, which was the whole problem.
  const proxiedFor = new Set(app.votes.filter((v) => v.recordedByUserId).map((v) => v.userId))
  for (const [id, cast] of Object.entries(justCast)) {
    voteMap.set(id, cast.vote)
    // An admin recording for a trustee is a proxy; a trustee voting for themselves
    // CLEARS one, exactly as `castVote` does to the row.
    if (cast.proxied) proxiedFor.add(id)
    else proxiedFor.delete(id)
  }

  const yesVotes = [...voteMap.values()].filter((v) => v === 'yes').length
  const tally: Tally = {
    voterCount: app.voterCount,
    voted: voteMap.size,
    yesVotes,
    hasMajority: app.voterCount > 0 && yesVotes * 2 > app.voterCount,
  }
  const myVote = voteMap.get(userId)
  const detail = app.custodianScoreDetail
  const scored = app.custodianScoreStatus === 'scored' && app.custodianScore !== null
  const programme = app.roundProgramme?.programme
  // The amount that would be AWARDED heads the card: it is what the board is voting on.
  // The ask stays beside it wherever the two differ.
  const amount = app.effectiveAmount
  const requested = decidedAmount(app.amountRequested)
  const amended = app.amountAmended !== null && Math.abs(amount - requested) >= 0.005
  const years = app.roundProgramme?.grantDurationYears ?? null
  // Resolved server-side (stated, else the ask divided by the duration) so the card and
  // the budget meter above it cannot apply different rules to the same grant.
  const firstYear = app.firstYearAmount
  // Only a grant whose cash and commitment differ has two figures worth printing.
  const multiYear = Math.abs(firstYear - amount) >= 0.005

  const unitLabel = impactUnitLabel(programme?.impactUnit, programme?.impactUnitLabel)
  const impact = app.proposedImpactQuantity ? Number(app.proposedImpactQuantity) : null
  const costPerUnit = impact && impact > 0 ? amount / impact : null

  // Narrow on the payload's own discriminant rather than the denormalised status
  // column, so the fields we read are guaranteed present by the type.
  const deprivation = app.deprivationContext?.status === 'resolved' ? app.deprivationContext : null
  // The area only. The foundation's reference used to follow it, and a board has no use
  // for one: it is on the application, a click away, for whoever does.
  const subline = deliveryAreaLabel(app) ?? ''

  const flags = detail?.flags ?? []
  const orgSummary =
    app.organisationSummary?.trim() || app.organisationProfile?.activities?.trim() || null

  // The comps drop due diligence from this card entirely, which is right while it is
  // clear and wrong the moment it is not: a board must not approve a grant to a charity
  // the registry flagged without the flag being on the screen they approve it from. So
  // it appears in the meta strip only when it has something to say.
  // `warning` says nothing here (2026-10-01): it is the commonest status by far (a late
  // filing, a recent trustee change), so "Due diligence warnings" sat on most cards and
  // told the board nothing it could act on. The detail is on the application.
  const ddNote =
    app.dueDiligenceStatus === 'blocked'
      ? 'Due diligence blocked'
      : app.dueDiligenceStatus === 'review'
        ? 'Due diligence needs a manual check'
        : app.dueDiligenceStatus === 'no_registration'
          ? // Said plainly rather than as "not run": the board is about to vote, and
            // "no register to check" is a fact about the applicant they should weigh,
            // not a job somebody forgot to do.
            'No charity or company number, so not screened'
          : app.dueDiligenceStatus === 'pending'
            ? 'Due diligence not run'
            : null

  // Figure and unit are separated so the figure can carry the weight (Figma 765:3377):
  // what a board scans this strip for is the numbers, not the words between them.
  // The size of the organisation asking, beside the size of the ask. Income is the
  // register's last filed year; reserves are the applicant's own figure from the form.
  // Each is simply left out where there is none, as the others on this strip are.
  // The form's figure first, as on the application: a company has no other.
  const statedIncome = app.organisationIncome != null ? parseFloat(app.organisationIncome) : null
  const income = statedIncome ?? app.organisationProfile?.latestIncome ?? null
  const reserves = app.unrestrictedReserves != null ? parseFloat(app.unrestrictedReserves) : null
  const meta = [
    impact !== null
      ? { value: impact.toLocaleString('en-GB'), label: unitLabel.toLowerCase() }
      : null,
    costPerUnit !== null ? { value: fmtExact(costPerUnit), label: 'each' } : null,
    deprivation
      ? { value: `IMD ${formatDecileRange(deprivation).toLowerCase()}`, label: '' }
      : null,
    income !== null
      ? {
          value: fmtMoney(income),
          label: statedIncome !== null ? 'income (stated)' : 'income (last filed year)',
        }
      : null,
    reserves !== null ? { value: fmtMoney(reserves), label: 'unrestricted reserves' } : null,
  ].filter((m) => m !== null)

  async function handleVote(vote: 'yes' | 'no', onBehalfOf?: string) {
    setBusy(true)
    setError(null)
    try {
      await castVote({ data: { applicationId: app.id, vote, onBehalfOf } })
      setJustCast((held) => ({
        ...held,
        [onBehalfOf ?? userId]: { vote, proxied: onBehalfOf !== undefined },
      }))
      setChanging(false)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record your vote')
    } finally {
      setBusy(false)
    }
  }

  return (
    // Kept whole on paper where it fits on a sheet: a card split across two pages has
    // its votes on one and what was voted on on the other.
    <div
      className="rounded-card border bg-white print:break-inside-avoid"
      style={{ borderColor: C.line }}
    >
      <div className="flex flex-col lg:flex-row">
        {/* ── The application ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
          <div className="flex items-center gap-3">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-chip"
              style={{ backgroundColor: C.wash }}
            >
              <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
                {initials(app.organisationName)}
              </span>
            </div>
            {/* Named as every list names a grantee (`ui/OrganisationCell`): the name, and
                one line of facts beneath, the pair sitting level with the monogram. The
                facts are where the application sits: its programme, behind the swatch it
                wears on the Proposed spend panel above (where the eye has just learnt the
                colours), and its area. The decision is the card's one pill, because it is
                the card's status, and stands beside the pair rather than on the name's
                line, where its height pushed the two lines off the monogram. */}
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <div className="min-w-0">
                <Link
                  to="/applications/$applicationId"
                  params={{ applicationId: app.id }}
                  className="block truncate font-display text-title leading-tight font-medium hover:underline"
                  style={{ color: C.ink }}
                >
                  {app.organisationName}
                </Link>
                {(programme?.name || subline) && (
                  <div
                    className="mt-0.5 flex min-w-0 items-center gap-1.5 font-display text-label"
                    style={{ color: C.sub }}
                  >
                    {programme?.name && (
                      <>
                        {programmeColour && (
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ backgroundColor: programmeColour }}
                          />
                        )}
                        <span className="truncate">{programme.name}</span>
                      </>
                    )}
                    {programme?.name && subline && <span aria-hidden>·</span>}
                    {subline && <span className="truncate">{subline}</span>}
                  </div>
                )}
              </div>
              <span className="shrink-0">
                <DecisionPill tally={tally} />
              </span>
            </div>
            <div className="shrink-0 text-right">
              {/* THIS YEAR leads, the whole commitment sits under it. Every other figure
                  on this screen is now cash — the budget meter above the cards, the round's
                  remaining balance — so a headline stating the full multi-year ask was the
                  one number that did not move with them, and a card reading £40,000 over a
                  meter that shifted by £20,000 invites the reader to reconcile two figures
                  that were never the same thing.
                  The total is not demoted to a footnote: it is what a trustee is voting to
                  give, so it is named in full, with its term, directly beneath. Where the
                  grant is single-year the two are equal, there is nothing to flip, and the
                  per-year line stays the more useful thing to say. */}
              <div className="font-display text-heading font-medium" style={{ color: C.ink }}>
                {canPropose && (
                  <button
                    type="button"
                    onClick={() => setEditingAmount(true)}
                    aria-label={`Change the amount to award ${app.organisationName}`}
                    title="Change the amount to award"
                    className="mr-1.5 inline-flex size-6 items-center justify-center rounded-chip align-middle hover:bg-grey-100 print:hidden"
                  >
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      size={14}
                      color={C.sub}
                      strokeWidth={1.8}
                    />
                  </button>
                )}
                {fmtMoney(multiYear ? firstYear : amount)}
                {/* "this year" rides WITH the figure rather than captioning it from the
                    line below. At a glance the eye takes the big number and moves on, and
                    a qualifier a line down is read as belonging to whatever else is on
                    that line — here, the total. Trailing rather than leading so the
                    figures still form a clean right-aligned column down the list. */}
                {multiYear && (
                  <span className="ml-1.5 text-label font-normal" style={{ color: C.sub }}>
                    this year
                  </span>
                )}
              </div>
              <div className="font-display text-label" style={{ color: C.faint }}>
                {multiYear
                  ? `${fmtMoney(amount)} ${
                      years && years > 1 ? `over ${years} years` : 'total commitment'
                    }`
                  : (fmtPerYear(amount, years) ?? (amended ? null : 'requested'))}
                {/* The ask, on the same line and only where the proposal differs from it:
                    an unamended card reads exactly as it always has. Struck through,
                    because it is the figure the proposal replaced; who changed it and
                    why is the Activity half of the button in the vote column. */}
                {amended && (
                  <>
                    {multiYear || fmtPerYear(amount, years) ? ' · asked ' : 'asked '}
                    <s>{fmtMoney(requested)}</s>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Who they are, before what they want: the applicant's own description,
              else the Charity Commission's (a company's register entry has none). */}
          {orgSummary && (
            <ClampedSection
              label="Organisation summary"
              text={orgSummary}
              toggleLabel="Read the full organisation summary"
            />
          )}

          {app.grantPurpose && (
            <ClampedSection
              label="Grant purpose"
              text={app.grantPurpose}
              toggleLabel="Read the full purpose"
            />
          )}

          {detail?.summary && (
            <ClampedSection
              label="AI assessment"
              text={detail.summary}
              toggleLabel="Read the full assessment"
              assessment
            />
          )}

          {flags.length > 0 && (
            <div className="rounded-control px-3.5 py-2.5" style={{ backgroundColor: C.amberWash }}>
              {/* The heading is the toggle. The count stays on it either way, so a closed
                  panel still says how much there is to read. */}
              <button
                type="button"
                onClick={() => setFlagsOpen((open) => !open)}
                aria-expanded={flagsOpen}
                className="flex w-full items-center gap-1.5 text-left"
              >
                <HugeiconsIcon icon={Alert02Icon} size={14} color={C.amber} strokeWidth={1.8} />
                <span className="font-display text-label font-medium" style={{ color: C.amber }}>
                  {flags.length === 1 ? 'One thing to check' : `${flags.length} things to check`}
                </span>
                <span className="ml-auto print:hidden">
                  <HugeiconsIcon
                    icon={flagsOpen ? ArrowUp01Icon : ArrowDown01Icon}
                    size={14}
                    color={C.amber}
                    strokeWidth={1.8}
                  />
                </span>
              </button>
              {/* Numbered, so the board can say "the second one" across the table. A lone
                  flag gets no "1." under a heading that already says "One thing".
                  Always open in print: a PDF has nothing to press. */}
              <ol
                className={`mt-1.5 space-y-1 print:block ${flagsOpen ? '' : 'hidden'} ${
                  flags.length > 1 ? 'list-decimal pl-5' : ''
                }`}
              >
                {flags.map((f, i) => (
                  <li
                    key={i}
                    className="font-display text-label leading-relaxed"
                    style={{ color: C.amber }}
                  >
                    {f}
                  </li>
                ))}
              </ol>
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
              {tally.voted} of {tally.voterCount} voted
            </span>
          </div>
          {/* Votes stand when the amount changes; the board is told which were cast on a
              different figure, and the count falls as those members vote again. */}
          {app.votesBeforeChange > 0 && (
            <p className="-mt-1.5 font-display text-label leading-snug" style={{ color: C.amber }}>
              {app.votesBeforeChange === 1 ? '1 vote was' : `${app.votesBeforeChange} votes were`}{' '}
              cast before the amount changed
            </p>
          )}

          {voters.length === 0 ? (
            <p className="font-display text-label leading-relaxed" style={{ color: C.sub }}>
              Nobody holds a vote yet, so nothing can be approved.{' '}
              <Link
                to="/settings/team"
                className="font-medium hover:underline"
                style={{ color: C.brand }}
              >
                Invite trustees
              </Link>
            </p>
          ) : (
            // Across the sheet on paper: at print width the roster sits under the
            // application rather than beside it, and one name per line wasted the row.
            <div className="flex flex-col gap-2 print:grid print:grid-cols-2 print:gap-x-8">
              {voters.map((t) => {
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
                      {/* An admin on the board is named as one. The roster is how a
                          reader checks a majority, and "4 of 5" means something
                          different when one of the five runs the foundation. */}
                      {t.role !== 'trustee' && <span style={{ color: C.faint }}> (Admin)</span>}
                    </span>
                    {proxiedFor.has(t.id) && (
                      <span className="shrink-0 text-label" style={{ color: C.faint }}>
                        recorded for them
                      </span>
                    )}
                    {canVoteForTrustees && t.id !== userId && (
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

          {/* The comps put a bare comment box here. It is replaced by the latest remark
              and a split button that opens the thread on either tab — see
              `CommentsDialog` on why writing into a discussion you cannot read is the one
              thing this control must not be. Activity is the other half because a change
              to the amount is news to a board that has half voted on it. */}
          <div
            className="flex flex-col overflow-hidden rounded-control border print:hidden"
            style={{ borderColor: C.line }}
          >
            {app.latestComment && (
              <button
                type="button"
                onClick={() => setShowComments('comments')}
                className="flex flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors hover:bg-grey-50"
                style={{ borderColor: C.line }}
              >
                <span className="flex min-w-0 items-center gap-1.5 font-display text-label">
                  <Avatar
                    name={app.latestComment.user.name}
                    image={app.latestComment.user.image}
                    size={20}
                  />
                  <span className="min-w-0 truncate font-medium" style={{ color: C.ink }}>
                    {app.latestComment.user.name}
                  </span>
                  <span className="ml-auto shrink-0" style={{ color: C.faint }}>
                    {fmtSince(app.latestComment.createdAt)}
                  </span>
                </span>
                <span
                  className="line-clamp-2 font-display text-label leading-snug"
                  style={{ color: C.body }}
                >
                  {app.latestComment.body}
                </span>
              </button>
            )}
            <div className="flex">
              <button
                type="button"
                onClick={() => setShowComments('comments')}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 font-display text-label font-medium transition-colors hover:bg-grey-50"
                style={{ color: C.ink }}
              >
                <HugeiconsIcon icon={Message01Icon} size={14} color={C.sub} strokeWidth={1.8} />
                {app.commentCount === 0
                  ? 'Add a comment'
                  : `${app.commentCount} comment${app.commentCount === 1 ? '' : 's'}`}
              </button>
              <button
                type="button"
                onClick={() => setShowComments('activity')}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 border-l font-display text-label font-medium transition-colors hover:bg-grey-50"
                style={{ borderColor: C.line, color: C.ink }}
              >
                {/* The glyph Settings' Activity tile wears, so the two read as one thing. */}
                <HugeiconsIcon icon={HistoryIcon} size={14} color={C.sub} strokeWidth={1.8} />
                Activity
                {app.activityCount > 0 && (
                  <span style={{ color: C.faint }}>{app.activityCount}</span>
                )}
              </button>
            </div>
          </div>

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

          {canVoteAsSelf &&
            myVote !== undefined &&
            !changing && (
              // Not printed, like the line below it: both speak to whoever is signed in,
              // and the pack is read by the whole board. The roster already says it.
              <div
                className="flex flex-col items-center gap-1 rounded-control py-3 print:hidden"
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
            <p
              className="font-display text-label leading-snug print:hidden"
              style={{ color: C.sub }}
            >
              {canVoteAsSelf
                ? 'You hold a vote, and can record the other members’ votes on their behalf.'
                : 'You are recording votes on trustees’ behalf.'}
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
            className="mt-auto pt-1 text-center text-body print:hidden"
          >
            View Application details →
          </TextLink>
        </div>
      </div>

      {canPropose && (
        <AmountDialog
          open={editingAmount}
          onClose={() => setEditingAmount(false)}
          onConfirm={async (change) => {
            if (!change.changed) return
            await setAmendedAmount({
              data: {
                id: app.id,
                amount: change.amount,
                firstYearAmount: change.firstYearAmount,
                note: change.note || undefined,
              },
            })
            await router.invalidate()
          }}
          mode="edit"
          organisationName={app.organisationName}
          amountRequested={requested}
          amountAmended={app.amountAmended === null ? null : parseFloat(app.amountAmended)}
          firstYear={firstYear}
          firstYearIsSuggested={app.firstYearIsSuggested}
          durationYears={years}
          financialYearLabel={amountContext.financialYearLabel}
          budgetRemaining={amountContext.budgetRemaining}
          enforced={amountContext.enforced}
          votesCast={app.votes.length}
        />
      )}

      {showComments && (
        <CommentsDialog
          applicationId={app.id}
          organisationName={app.organisationName}
          userId={userId}
          userRole={userRole}
          initialTab={showComments}
          onClose={() => setShowComments(null)}
          onChanged={() => router.invalidate()}
        />
      )}
    </div>
  )
}
