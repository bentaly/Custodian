import { createFileRoute, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Coins01Icon,
  UserGroupIcon,
  UserGroup02Icon,
  Building02Icon,
  MoneyReceive01Icon,
  SafeBoxIcon,
  File01Icon,
  Mail01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons'
import {
  getApplication,
  rerunDueDiligence,
  updateApplicationStatus,
} from '../../server/fns/applications'
import { ApplicationSubmissionDialog } from '../../components/ApplicationSubmissionDialog'
import { CommentsSection } from '../../components/CommentsSection'
import { VotingSection } from '../../components/VotingSection'
import { ProgressBar } from '../../components/ProgressBar'
import { BarMeter, withAlpha } from '../../components/BarMeter'
// DetailHeader / Panel / PanelTitle are the shared detail-screen furniture (`ui/Detail`),
// which this screen's grant and report siblings wear too.
import {
  Breadcrumb,
  Button,
  CompactMoney,
  DetailHeader,
  KPI_TINTS,
  LinkButton,
  MiniKpi,
  Panel,
  PanelTitle,
  Tooltip,
  TruncatedText,
  useClamp,
  ClampToggle,
} from '../../components/ui'
import { ScoreRing } from '../../components/charts/ScoreRing'
import {
  CRITERION_DEFINITIONS,
  CRITERION_ORDER,
  type CustodianScoreDetail,
} from '../../lib/custodianScore'
import { applicationStatusLabel } from '../../lib/validators/application'
import { impactUnitLabel, impactUnitSingular } from '../../lib/impactUnits'
import { CHECK_DEFINITIONS, type DueDiligenceCheckRecord } from '../../lib/dueDiligence'
import { fieldGaps, missingRegistrationNumber } from '../../lib/fieldMapping/gaps'
import type { DeprivationContext } from '../../lib/deprivation/types'
import type { OrganisationProfile } from '../../lib/dueDiligence'
import type { BudgetLine } from '../../lib/budget/types'
import { budgetDocumentName } from '../../lib/budget/link'
import { fmtDate, fmtDuration, fmtMoney, fmtPerYear, fmtRef } from '../../lib/format'
import { colourSeries } from '../../lib/programmeColours'
import { C as TOKENS, bandForScore } from '../../components/ui/tokens'

export const Route = createFileRoute('/_authenticated/applications/$applicationId')({
  loader: ({ params }) => orNotFound(getApplication({ data: { id: params.applicationId } })),
  component: ApplicationDetail,
})

// ─── Design tokens ───────────────────────────────────────────────────────────────
const C = {
  ...TOKENS,
  ink700: 'var(--color-grey-700)',
}
// The stat row's five tints are `KPI_TINTS` — the shared list, in the order the comps
// (435:38511) read across. This screen used to carry its own copy built from the
// SEMANTIC hues, which is why its cream and blush cards came out tan and grey-pink and
// its last card mixed an `info` fill with a `sky` accent.
const KPI = {
  amount: KPI_TINTS.violet,
  income: KPI_TINTS.green,
  area: KPI_TINTS.amber,
  reserves: KPI_TINTS.pink,
  community: KPI_TINTS.sky,
}

// ─── Formatting ──────────────────────────────────────────────────────────────────
// (The monogram's `initials` is `ui/Avatar`'s now, via `DetailHeader` — this screen used
// to take first + last word where the applications table takes the first two, so the same
// organisation wore two different monograms on the row and the page it opened.)
// ─── Primitives ──────────────────────────────────────────────────────────────────

/**
 * The "show the rest" control this screen uses twice — under the score's flags and
 * under the due diligence checks. One component, because they sit a screen apart and
 * had already drifted into two different things (an underlined bare `<button>` and
 * nothing at all).
 *
 * A `Button`, not a hand-rolled `<button>`: `secondary` gives it the app's control
 * chrome, so a thing you click looks like a thing you click. The chevron turns over,
 * which is the only part of the state a glance actually reads.
 *
 * Not what the organisation summary uses. That one opens a paragraph inside a card
 * sitting BESIDE the grant purpose, where a full-width button costs a row of height the
 * layout does not have — so it wears `ClampToggle`, a chevron on the heading itself.
 */
function Disclosure({
  open,
  onToggle,
  showLabel,
  hideLabel,
}: {
  open: boolean
  onToggle: () => void
  showLabel: string
  hideLabel: string
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={open ? ArrowUp01Icon : ArrowDown01Icon}
      iconPosition="right"
      onClick={onToggle}
      aria-expanded={open}
    >
      {open ? hideLabel : showLabel}
    </Button>
  )
}

/**
 * One cell of the organisation panel's fact grid: a label, a figure, and optionally the
 * period or ratio that figure only means something with.
 *
 * `empty` is the load-bearing prop. A missing figure here is never an em dash, because
 * on this panel a dash is ambiguous in the one way the whole ingest design exists to
 * prevent: "£0 of reserves", "the register does not publish it" and "we never asked"
 * are three different facts about a charity, and only one of them is a reason to worry.
 * So the caller states which, and it is set in the muted weight so it never reads as a
 * value. See `fieldGaps` for the same rule applied to the application's own fields.
 */
function Fact({
  label,
  value,
  empty,
  note,
}: {
  label: string
  /** `null` means we do not have it — say why in `empty`. A node, not a string, so a
   *  rounded figure can bring its own exact-value tooltip (`CompactMoney`). */
  value: React.ReactNode
  /** What to print instead, in the reader's terms. Defaults to a dash only because a
   *  few cells are omitted entirely when empty and never reach this. */
  empty?: string
  /** The qualifier that makes the figure true — "year to 31 Mar 2025", "~9 months'
   *  spend". A bare £1.4m reads as today's, and the register is routinely 12-18 months
   *  behind. */
  note?: string | null
}) {
  return (
    <div>
      <dt className="font-display text-label" style={{ color: C.sub }}>
        {label}
      </dt>
      <dd
        className={`mt-0.5 font-display text-body ${value ? 'font-medium' : ''}`}
        style={{ color: value ? C.ink : C.faint }}
      >
        {value ?? empty ?? '—'}
      </dd>
      {value && note && (
        <dd className="font-display text-label" style={{ color: C.sub }}>
          {note}
        </dd>
      )}
    </div>
  )
}

/**
 * The way out of the one dead end due diligence has: an application with no
 * registration number can never be screened, and pressing Re-run reads the same empty
 * columns and returns "not screened" forever.
 *
 * This is now the ordinary case rather than an exotic one. A submission arriving with
 * neither number is created rather than held (the pair is `expected`, not `one_of`),
 * because plenty of real applicants hold neither — so this panel is where a foundation
 * that later obtains a number gets the screening done. It also serves the two routes
 * that could never be fixed upstream: a grant imported from a back catalogue arrives
 * already awarded and deliberately unscreened, and an application awarded before the
 * one-of gate has its ingest mapping frozen because the award letter was written from
 * those figures. A registration number is not one of those figures, and a grantee still
 * receiving instalments is exactly the one worth screening late.
 */
function ScreenWithNumber({ applicationId, canEdit }: { applicationId: string; canEdit: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [charityNumber, setCharityNumber] = useState('')
  const [companyNumber, setCompanyNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await rerunDueDiligence({ data: { id: applicationId, charityNumber, companyNumber } })
      await router.invalidate()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="font-display text-body" style={{ color: C.sub }}>
        Not screened — this application has no charity number or company number, so there is no
        register to check it against. Re-running will not change that.
      </p>
      {canEdit && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 font-display text-body font-medium underline underline-offset-2"
          style={{ color: C.brand }}
        >
          Add a registration number and screen now
        </button>
      )}
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="font-display text-label" style={{ color: C.sub }}>
            Give whichever the organisation holds — either alone is enough. The checks run
            immediately, and the number is recorded against this application.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={charityNumber}
              onChange={(e) => setCharityNumber(e.target.value)}
              placeholder="Charity number (e.g. 219279 or SC003558)"
              className="min-w-56 flex-1 rounded-chip border px-3 py-2 font-display text-body"
              style={{ borderColor: C.line }}
            />
            <input
              value={companyNumber}
              onChange={(e) => setCompanyNumber(e.target.value)}
              placeholder="Company number (e.g. 03782379)"
              className="min-w-56 flex-1 rounded-chip border px-3 py-2 font-display text-body"
              style={{ borderColor: C.line }}
            />
          </div>
          {error && (
            <p className="font-display text-label" style={{ color: C.danger }}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={submit}
              disabled={busy || (!charityNumber.trim() && !companyNumber.trim())}
            >
              {busy ? 'Screening…' : 'Save and screen'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Header action. `tone` is this screen's older vocabulary for what are now `Button`
 * variants; it stays only because one of these actions is a mailto link, which has to
 * render as an `<a>` while looking identical to the buttons beside it.
 */
const HEADER_TONE = {
  primary: 'primary',
  brand: 'tinted',
  plain: 'secondary',
  danger: 'dangerGhost',
} as const

function HeaderButton({
  tone,
  icon,
  onClick,
  disabled,
  href,
  children,
  ...described
}: {
  tone: keyof typeof HEADER_TONE
  icon?: typeof File01Icon
  onClick?: () => void
  disabled?: boolean
  href?: string
  children: React.ReactNode
  /** Forwarded so a wrapping `Tooltip control` can describe the control itself. */
  'aria-describedby'?: string
}) {
  const variant = HEADER_TONE[tone]
  if (href) {
    // Same box as `Button`'s md size, on an anchor.
    const style =
      variant === 'tinted'
        ? { backgroundColor: C.brandBg, color: C.brand, borderColor: C.brandBorder }
        : { backgroundColor: '#fff', color: C.ink, borderColor: C.line }
    return (
      <a
        href={href}
        {...described}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-control border px-4 font-display text-body font-medium"
        style={style}
      >
        {icon && <HugeiconsIcon icon={icon} size={18} color="currentColor" />}
        {children}
      </a>
    )
  }
  return (
    <Button variant={variant} icon={icon} onClick={onClick} disabled={disabled} {...described}>
      {children}
    </Button>
  )
}

function CriterionBar({ label, score }: { label: string; score: number }) {
  // Out of 10, so the bands are 7/4 — same registry as the composite ring above.
  const colour = bandForScore(score, 10).fill
  return (
    <div className="flex items-center gap-4">
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
        track={withAlpha(colour, 0.2)}
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

// ─── Screen ──────────────────────────────────────────────────────────────────────

function ApplicationDetail() {
  const application = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const [rerunningDD, setRerunningDD] = useState(false)
  const [showAllDd, setShowAllDd] = useState(false)
  const [showAllFlags, setShowAllFlags] = useState(false)
  const [shortlisting, setShortlisting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submissionOpen, setSubmissionOpen] = useState(false)

  const isShortlisted = application.status === 'shortlisted'
  const isDeclined = application.status === 'declined'
  const isAwarded = application.status === 'awarded'
  const awardId = application.award?.id ?? null

  // Shortlist / Decline are `updateApplicationStatus`, which is admin-only. A trustee
  // reads, comments and votes; moving an application through the pipeline is not theirs
  // to do. So the buttons are not shown rather than shown and refused — a control that
  // can only ever answer "You do not have access to that" is worse than no control.
  const canSetStatus = user.role === 'admin' || user.role === 'superadmin'

  const rp = application.roundProgramme
  const programme = rp.programme
  const clientName = programme.client?.name ?? null
  const roundName = rp.round?.name ?? null
  const budget = rp.budget ? parseFloat(rp.budget) : null
  const committed = application.roundProgrammeCommitted
  const amountRequested = parseFloat(application.amountRequested)
  const isBudgetFull = !isShortlisted && budget !== null && committed + amountRequested > budget

  const scoreStatus = application.custodianScoreStatus ?? 'pending'
  const score = application.custodianScore
  const scoreDetail = application.custodianScoreDetail as CustodianScoreDetail | null
  const scored = scoreStatus === 'scored' && score != null && scoreDetail != null
  const grantPurpose = application.grantPurpose?.trim() || null

  // The model can return a dozen flags, and a wall of red under the score buries the
  // score. Two is enough to say "there are concerns here"; the rest are one click away.
  // Unlike the due diligence panel below — where a flag must never be behind a toggle —
  // these are all the same kind of thing, so cutting the list hides no distinction.
  const FLAGS_SHOWN = 2
  const allFlags = scored ? scoreDetail.flags : []
  const visibleFlags = showAllFlags ? allFlags : allFlags.slice(0, FLAGS_SHOWN)
  const hiddenFlagCount = allFlags.length - FLAGS_SHOWN

  const ddRecords = (application.dueDiligenceChecks as DueDiligenceCheckRecord[] | null) ?? []
  // A clean screen is twenty-odd green rows, and the one thing worth reading — a flag —
  // is somewhere among them. So passed checks are collapsed by default and anything
  // that is NOT a pass (a failure, or a check that couldn't be verified) always shows:
  // hiding a flag behind a toggle is the one thing this panel must never do.
  const passedDdCount = ddRecords.filter((r) => r.result === 'pass').length
  const visibleDdRecords = showAllDd ? ddRecords : ddRecords.filter((r) => r.result !== 'pass')

  const deprivation = application.deprivationContext as DeprivationContext | null
  const depResolved = application.deprivationStatus === 'resolved' && deprivation != null
  const region = application.deliveryRegion ?? application.deliveryArea ?? null

  const budgetLines = (application.budgetBreakdown as BudgetLine[] | null) ?? []
  const budgetTotal = budgetLines.reduce((s, l) => s + l.amount, 0) || amountRequested
  // One colour per line rather than a five-entry list cycled — the swatch is the only
  // thing tying a legend row to its segment in the bar, so two lines sharing one broke
  // the reading of any budget with six lines in it.
  const budgetColours = useMemo(() => colourSeries(budgetLines.length), [budgetLines.length])

  // A budget sent as a file rather than as fields. Opaque to us — nothing reads it, so
  // it feeds neither the breakdown above nor the Custodian score — but it answers the
  // same question for a reader, which is why it satisfies the budget pair in `gaps`.
  const budgetLink = application.budgetBreakdownLink ?? null
  const budgetLinkName = budgetLink ? budgetDocumentName(budgetLink) : null

  // Beneficiaries + cost-per-beneficiary come from what the applicant PROPOSES on
  // this application (a forward-looking count in the programme's impact unit).
  const unitLabel = impactUnitLabel(programme.impactUnit, programme.impactUnitLabel)
  const unitSingular = impactUnitSingular(programme.impactUnit, programme.impactUnitLabel)
  const proposedImpact =
    application.proposedImpactQuantity != null
      ? parseFloat(application.proposedImpactQuantity)
      : null
  const costPerBeneficiary =
    proposedImpact && proposedImpact > 0 ? amountRequested / proposedImpact : null

  // What this submission never captured. A field that didn't map leaves a null column,
  // indistinguishable from a question the foundation never asked — so the feature it
  // feeds silently doesn't run. Stating it is the difference between noticing in the
  // queue and noticing weeks later, if at all.
  const gapValues = {
    charityNumber: application.charityNumber,
    companyNumber: application.companyNumber,
    deliveryArea: application.deliveryArea,
    budgetBreakdown: budgetLines,
    budgetBreakdownLink: application.budgetBreakdownLink,
    proposedImpactQuantity: application.proposedImpactQuantity,
  }
  const gaps = fieldGaps(gapValues)
  const noRegistrationNumber = missingRegistrationNumber(gapValues)

  // ── What the register says the applicant IS ────────────────────────────────
  // Captured by `runDueDiligence` on the same calls the checks come from, so this
  // costs no extra screening — see `OrganisationProfile`. Null whenever there was
  // nothing to read: no charity number, a Scottish charity, or a company-only
  // applicant. That distinction is stated rather than left as an em dash, because a
  // blank figure and an unasked question must never look the same.
  const orgProfile = (application.organisationProfile as OrganisationProfile | null) ?? null
  // Whether the register's description overflows its two lines, and the open/closed
  // state of the chevron that reveals the rest. Measured, not guessed — see `useClamp`.
  const activities = useClamp(orgProfile?.activities)
  const orgIncome = orgProfile?.latestIncome ?? null
  // Not available from the Charity Commission at all (verified against the live API —
  // see the field's note). Always null until it is asked for on the application form,
  // which is why the card says "not captured" rather than showing nothing.
  const orgReserves = orgProfile?.unrestrictedReserves ?? null
  const orgSpend = orgProfile?.latestExpenditure ?? null
  // The figures are as at the last FILED accounts — routinely twelve to eighteen
  // months old — so the period travels with them. A bare "£412,000" reads as today's.
  const orgPeriodEnd = orgProfile?.financialPeriodEnd
    ? fmtDate(orgProfile.financialPeriodEnd)
    : null
  // Months of spending the reserves would cover: what a board actually reasons with,
  // and the reason reserves are worth holding as a number rather than as a note.
  const reserveMonths =
    orgReserves != null && orgSpend != null && orgSpend > 0
      ? Math.round((orgReserves / orgSpend) * 12)
      : null
  // The register facts, as the four cells the panel reads them off in. They were one
  // dot-joined sentence until the panel went two-up: "Registered 1998 · Charitable
  // company · income £1.4m (year to 31 Mar 2025) · unrestricted reserves not captured ·
  // 22 staff" is a line a reader has to PARSE to answer "what is their income", which is
  // the one question the colleague who asked for this panel asks first. A labelled cell
  // is read, not parsed. Income and reserves always render — an unanswered question must
  // look different from a blank, not identical to one — while the two context cells drop
  // out when the register holds nothing for them.
  const orgRegistered =
    [
      orgProfile?.registeredSince
        ? `Registered ${new Date(orgProfile.registeredSince).getFullYear()}`
        : null,
      orgProfile?.charityType,
    ]
      .filter(Boolean)
      .join(' · ') || null
  const orgPeople =
    [
      orgProfile?.employees != null
        ? `${orgProfile.employees.toLocaleString('en-GB')} staff`
        : null,
      orgProfile?.volunteers != null
        ? `${orgProfile.volunteers.toLocaleString('en-GB')} volunteers`
        : null,
    ]
      .filter(Boolean)
      .join(' · ') || null

  // Why there is no profile, in the applicant's own terms. Screening that has not run
  // yet is not the same as an applicant there is nothing to screen.
  const orgAbsence = noRegistrationNumber
    ? 'No charity or company number was captured, so there is no register entry to read.'
    : application.charityNumber
      ? 'Not read yet — re-run the register checks below to fetch it.'
      : 'Companies House publishes no income or activity summary, so there is nothing to show for a company-only applicant.'

  async function act(setBusy: (b: boolean) => void, fn: () => Promise<unknown>) {
    setError(null)
    setBusy(true)
    try {
      await fn()
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const handleShortlist = () =>
    act(setShortlisting, () =>
      updateApplicationStatus({
        data: { id: application.id, status: isShortlisted ? 'for_review' : 'shortlisted' },
      }),
    )
  const handleDecline = () =>
    act(setDeclining, () =>
      updateApplicationStatus({
        data: { id: application.id, status: isDeclined ? 'for_review' : 'declined' },
      }),
    )
  const handleRerunDD = () =>
    act(setRerunningDD, () => rerunDueDiligence({ data: { id: application.id } }))

  // Colour is this screen's; the wording comes from the status registry, so the header
  // pill says exactly what the list and its filter say.
  const statusColour = isAwarded
    ? C.brand
    : isShortlisted
      ? C.success
      : isDeclined
        ? C.danger
        : C.amber
  const statusMeta = { label: applicationStatusLabel(application.status), colour: statusColour }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb
        items={[
          { label: 'Applications', to: '/applications', search: { roundId: undefined } },
          { label: application.organisationName },
        ]}
      />

      {/* Header — Figma 435:38405, now the shared `DetailHeader` the grant and report
          screens wear too. The decision buttons live here rather than in a sidebar, so
          the whole page is one full-width column. */}
      <DetailHeader
        backTo="/applications"
        backSearch={{ roundId: undefined }}
        backLabel="Back to applications"
        name={application.organisationName}
        subline={[
          programme.name,
          application.charityNumber ? `Charity no. ${application.charityNumber}` : null,
          region,
          roundName ? `${roundName} round` : null,
          // Their own reference for this application — the string they quote when they
          // ring up about it, and the one identifying fact the header had not got.
          fmtRef(application.externalApplicationId),
        ]
          .filter(Boolean)
          .join(' · ')}
        status={statusMeta}
        actions={
          <>
            {/* A plain mailto rather than anything we send: this is the grants team
                picking up the phone, so it belongs in their own mail client with their
                own signature and a copy in their sent items. Hidden when the
                application carries no contact address. */}
            {application.applicantEmail && (
              // `control`: the address DESCRIBES a link that already names itself, so
              // the tooltip must not add a tab stop or a second name over the top of it.
              <Tooltip
                control
                label="Applicant email address"
                trigger={
                  <HeaderButton
                    tone="plain"
                    icon={Mail01Icon}
                    href={`mailto:${encodeURIComponent(application.applicantEmail)}?subject=${encodeURIComponent(
                      `Your application to ${clientName ?? 'us'}${
                        application.externalApplicationId
                          ? ` (${application.externalApplicationId})`
                          : ''
                      }`,
                    )}`}
                  >
                    Email applicant
                  </HeaderButton>
                }
              >
                {application.applicantEmail}
              </Tooltip>
            )}
            <HeaderButton tone="brand" icon={File01Icon} onClick={() => setSubmissionOpen(true)}>
              View Submission
            </HeaderButton>
            {isAwarded ? (
              // Awarded is terminal *here*: `updateApplicationStatus` refuses to move an
              // application with a live award row, so a status button or dropdown in this
              // slot would be a control that can only ever error. The real onward action
              // is the grant itself — that is where the schedule, the letter and (when it
              // is built) cancelling live.
              awardId ? (
                <LinkButton
                  variant="primary"
                  to="/awards/$awardId"
                  params={{ awardId }}
                  icon={CheckmarkCircle02Icon}
                >
                  View award
                </LinkButton>
              ) : (
                // Awarded with no award row — not yet backfilled. State, not action.
                <span
                  className="flex h-10 shrink-0 items-center gap-2 rounded-control border px-3 font-display text-body font-medium"
                  style={{
                    backgroundColor: C.brandBg,
                    borderColor: C.brandBorder,
                    color: C.brand,
                  }}
                >
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} color={C.brand} />
                  Awarded
                </span>
              )
            ) : (
              canSetStatus && (
                <>
                  <HeaderButton tone="danger" onClick={handleDecline} disabled={declining}>
                    {declining ? '…' : isDeclined ? 'Reinstate to review' : 'Decline'}
                  </HeaderButton>
                  {/* The reason a button is DISABLED is the one explanation a `title`
                      can never deliver: a disabled button takes no focus, so a keyboard
                      user has no way to reach it, and several browsers decline to draw
                      the tip at all. So when the budget is full the button is wrapped in
                      the tooltip's own focusable trigger — which is a tab stop precisely
                      because the button it wraps is not. When the button is live it
                      wears nothing, and stays the single tab stop it should be. */}
                  {(() => {
                    const shortlistButton = (
                      <HeaderButton
                        tone={isShortlisted ? 'plain' : 'primary'}
                        onClick={handleShortlist}
                        disabled={shortlisting || isBudgetFull}
                      >
                        {shortlisting
                          ? '…'
                          : isShortlisted
                            ? 'Remove from shortlist'
                            : isBudgetFull
                              ? 'Budget full'
                              : 'Shortlist'}
                      </HeaderButton>
                    )
                    return isBudgetFull ? (
                      <Tooltip label="Why shortlisting is unavailable" trigger={shortlistButton}>
                        Budget committed — no funds remaining in this programme.
                      </Tooltip>
                    ) : (
                      shortlistButton
                    )
                  })()}
                </>
              )
            )}
          </>
        }
      />

      {error && (
        <div
          className="rounded-chip border px-3 py-2 font-display text-body"
          style={{
            borderColor: withAlpha(C.danger, 0.3),
            backgroundColor: withAlpha(C.danger, 0.06),
            color: C.danger,
          }}
        >
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-col gap-4">
        {/* What the money would fund — stated before anything we made of it. Its own
            panel rather than a line inside the assessment below, because it is a
            statement of fact carrying no judgement, and because it is present on rows
            the score is missing from (an imported grant, a failed scoring run). */}
        {/* The applicant's own ask. The grant it becomes carries its OWN purpose — what
            the foundation agreed to fund, written at award set-up and printed on the
            letter — shown under "Awarded for" on the grant screen. That one is prefilled
            from this one and then edited, so the two differ on most grants. */}
        {(grantPurpose || orgProfile || noRegistrationNumber) && (
          <Panel label="grant purpose">
            {/* Two columns, not two stacked blocks. The ask and who is asking are read
                together, and stacked they were read in sequence: the organisation
                arrived as a footnote under a rule, after the eye had already moved on
                to the score. Side by side, neither is subordinate — and the purpose
                gains its weight from no longer SHARING its full measure with anything,
                which is the cheapest emphasis available.

                Weight from TYPE, not from a fill. Three treatments were drawn for this
                panel: an editorial lede, a brand-green plate and an inverted dark card.
                The lede is the only one that does not spend a colour the rest of the
                product has given a meaning. Green is the brand — the AI-analysis pill,
                the awarded state, primary buttons — so a green plate would read as
                system-endorsed, which is the opposite of what this sentence is. And
                there is no dark surface anywhere in the app: a grants officer works
                through forty of these in a sitting, and by the fifth a black block has
                stopped reading as emphasis. The size doing the work is `text-title`
                (16px) — one step over the body around it, and no more than that. The
                emphasis is carried by the rule, the display face and the half-measure
                the two columns give it, none of which cost a rank the header needs.

                The columns stack below `lg`, which puts the organisation back
                underneath — the same order it had before, and the right one when there
                is only one column's width to give it. */}
            <div className={grantPurpose ? 'grid gap-6 lg:grid-cols-2 lg:gap-8' : ''}>
              {/* A column, so the caption can be pushed to the FOOT of it. The grant
                  purpose is capped at 40 words and the organisation card runs to five
                  rows, so the left column always bottoms out first and left a hole under
                  it. Sinking the caption spends that gap on something real and keeps the
                  two section labels on the same line, which centring the column would
                  have broken. Below `lg` the columns stack and `mt-auto` is inert, so
                  the caption goes back to hugging the sentence it qualifies. */}
              {grantPurpose && (
                <div className="flex flex-col">
                  <p
                    className="font-display text-label font-medium uppercase"
                    style={{ color: C.sub, letterSpacing: '0.06em' }}
                  >
                    Grant purpose
                  </p>
                  {/* A brand rule, not a brand fill. The rail carries the green at a
                      fraction of the surface area a tinted plate would, so the sentence
                      is marked as the one the panel is about without reading as
                      system-endorsed — which matters here, because this text is written
                      by the scoring model rather than quoted from the applicant. */}
                  <p
                    className="mt-2 border-l-3 pl-2 font-display text-title leading-relaxed"
                    style={{ color: C.ink, borderColor: C.brand }}
                  >
                    {grantPurpose}
                  </p>
                  {/* The one line of copy on this panel that has to be exactly right.
                      `grantPurpose` is written by the scoring model (see
                      `CustodianScoreOutputSchema` — one or two sentences, 40 words, no
                      judgement), NOT quoted from the applicant. Captions calling it "the
                      applicant's own words" were drafted for this panel and are false:
                      the whole point of giving it this much weight is that a reader can
                      trust what it says it is. The 40-word cap is also what keeps it to
                      a few lines — free text with a column to itself runs to a wall. */}
                  <p
                    className="mt-3 font-display text-label lg:mt-auto lg:pt-6"
                    style={{ color: C.sub }}
                  >
                    Summarised from the application
                  </p>
                </div>
              )}

              {/* Who they are, beside what they would do with the money. Everything in
                  here is read from the register, so it is the one block on the screen
                  that is neither the applicant's claim nor the model's reading — which
                  is what the tint is for: a change of ground marking a change of
                  source, not a decorative panel. */}
              <div className="rounded-card p-5" style={{ backgroundColor: C.wash }}>
                {/* The chevron rides the heading rather than sitting under the text.
                    A full-width disclosure button below the paragraph costs a whole row
                    of height on a card whose argument is that it fits BESIDE the grant
                    purpose; here it costs nothing, and it reads as "there is more of
                    this section" at the moment the eye arrives at the section. It is
                    rendered only when the description is actually clipped. */}
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={Building02Icon} size={14} color={C.sub} />
                  <p
                    className="font-display text-label font-medium uppercase"
                    style={{ color: C.sub, letterSpacing: '0.06em' }}
                  >
                    The organisation
                  </p>
                  {activities.clipped && (
                    <ClampToggle
                      open={activities.open}
                      onToggle={activities.toggle}
                      label="Read the full description"
                    />
                  )}
                  {/* Provenance reads as a byline, so it belongs on the heading row
                      rather than on a line of its own at the foot of the card: it fills
                      the empty right half of a row that already exists, and gives the
                      card back the line it was spending. */}
                  {orgProfile && (
                    <p
                      className="ml-auto font-display text-micro uppercase"
                      style={{ color: C.faint }}
                    >
                      Charity Commission · read {fmtDate(orgProfile.fetchedAt)}
                    </p>
                  )}
                </div>

                {orgProfile?.activities ? (
                  // The charity's OWN description, from its annual return — not ours
                  // and not a model's, which is why it needs no hedge. Length is
                  // uncontrolled (one sentence for a village hall, a paragraph for
                  // Cancer Research UK), so it is clamped on DISPLAY rather than on
                  // write: truncating what the register said before storing it would
                  // lose it for good. The chevron that opens it is up on the heading
                  // row, and appears only when there is something behind the fold.
                  <p
                    ref={activities.ref}
                    className={`mt-2 font-display text-body leading-relaxed ${activities.className ?? ''}`}
                    style={{ color: C.ink }}
                  >
                    {orgProfile.activities}
                  </p>
                ) : (
                  <p className="mt-2 font-display text-body" style={{ color: C.sub }}>
                    {orgProfile ? 'The register holds no activity summary.' : orgAbsence}
                  </p>
                )}

                {orgProfile && (
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                    <Fact
                      label="Income (last FY)"
                      value={
                        orgIncome != null ? (
                          <CompactMoney amount={orgIncome} label="Exact income" />
                        ) : null
                      }
                      empty={noRegistrationNumber ? 'no charity number' : 'not captured'}
                      note={orgPeriodEnd ? `year to ${orgPeriodEnd}` : null}
                    />
                    {/* Not published by the Charity Commission at ALL — verified against
                        the live API, see `OrganisationProfile.unrestrictedReserves`. So
                        this cell says which question was never asked rather than showing
                        a dash, which would read as a charity that holds none. */}
                    <Fact
                      label="Unrestricted reserves"
                      value={
                        orgReserves != null ? (
                          <CompactMoney amount={orgReserves} label="Exact reserves" />
                        ) : null
                      }
                      empty="not asked on the form"
                      note={reserveMonths != null ? `~${reserveMonths} months' spend` : null}
                    />
                    {orgRegistered && <Fact label="Registered" value={orgRegistered} />}
                    {orgPeople && <Fact label="People" value={orgPeople} />}
                  </dl>
                )}
              </div>
            </div>
          </Panel>
        )}

        {/* AI Assessment */}
        <Panel label="AI assessment">
          <PanelTitle>AI Assessment</PanelTitle>

          {scored ? (
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
              <div className="flex flex-1 items-center gap-4">
                <ScoreRing score={score} />
                <div>
                  <p className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
                    {scoreDetail.summary}
                  </p>
                  <span
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-display text-micro font-medium"
                    style={{ backgroundColor: C.brandBg, color: C.brand }}
                  >
                    AI analysis{roundName ? ` · ${roundName}` : ''}
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-3 lg:w-[260px] lg:shrink-0">
                {CRITERION_ORDER.map((key) => {
                  const c = scoreDetail.criteria[key]
                  if (!c) return null
                  return (
                    <CriterionBar
                      key={key}
                      label={CRITERION_DEFINITIONS[key].label}
                      score={c.score}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            <p className="font-display text-body" style={{ color: C.sub }}>
              {scoreStatus === 'error'
                ? 'Scoring failed — try re-scoring.'
                : scoreStatus === 'queued'
                  ? 'AI is currently scoring this application. It usually takes under a minute — reload to see the result.'
                  : 'This application has not been scored yet.'}
            </p>
          )}

          {scored && scoreDetail.flags.length > 0 && (
            <>
              <ul className="mt-4 flex flex-col gap-1.5">
                {visibleFlags.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-1.5 rounded-chip p-1.5 font-display text-label font-medium"
                    style={{ backgroundColor: withAlpha(C.danger, 0.05), color: C.danger }}
                  >
                    <HugeiconsIcon
                      icon={Alert02Icon}
                      size={16}
                      color={C.danger}
                      className="shrink-0"
                    />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {hiddenFlagCount > 0 && (
                <div className="mt-2">
                  <Disclosure
                    open={showAllFlags}
                    onToggle={() => setShowAllFlags((v) => !v)}
                    showLabel={`Show ${hiddenFlagCount} more flag${hiddenFlagCount === 1 ? '' : 's'}`}
                    hideLabel="Show fewer flags"
                  />
                </div>
              )}
            </>
          )}
        </Panel>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MiniKpi
            tint={KPI.amount}
            icon={Coins01Icon}
            label="Amount requested"
            /* Stated in full, never compacted. This is the one figure on the screen the
               card's own subline does arithmetic on ("£2,420 per year for 2 years"), and
               a headline that disagrees with the sum beneath it is read as an error in
               the application rather than in the formatting. It is also the number a
               grants officer quotes to a board. `sm` type fits seven figures. */
            value={fmtMoney(amountRequested)}
            /* The annual figure, not just the length: "£35k / 3 years" left it open
               whether the ask was £35k a year. Falls back to the plain duration for a
               single-year grant, where there is nothing to mistake it for. */
            sub={
              fmtPerYear(amountRequested, rp.grantDurationYears) ??
              fmtDuration(rp.grantDurationYears) ??
              'Duration not set'
            }
          />
          {/* Beneficiaries and cost-per-beneficiary are one card, not two: the second
              is the first divided into the amount already in the card beside it, so as
              separate cards it read as a new fact when it is the same one restated.
              Programme lost its card entirely — it is the FIRST item in the header
              subline above, so nothing is lost, and the two slots it and the cost card
              freed are what the finances now occupy. */}
          <MiniKpi
            tint={KPI.area}
            icon={UserGroupIcon}
            label="Beneficiaries"
            value={proposedImpact != null ? `~${proposedImpact.toLocaleString('en-GB')}` : '—'}
            sub={
              proposedImpact != null
                ? `${unitLabel.toLowerCase()}${costPerBeneficiary != null ? ` · ${fmtMoney(costPerBeneficiary)} each` : ''}`
                : 'not stated'
            }
          />
          {/* The applicant's own scale, next to what they are asking for — the pair a
              grants officer reads together to judge whether the ask is proportionate.
              `cc_grant_vs_income` already screens exactly this ratio; the difference is
              that a check reports a verdict and this reports the figure. */}
          <MiniKpi
            tint={KPI.income}
            icon={MoneyReceive01Icon}
            label="Income (last FY)"
            value={
              orgIncome != null ? <CompactMoney amount={orgIncome} label="Exact income" /> : '—'
            }
            sub={
              orgIncome != null
                ? orgPeriodEnd
                  ? `year to ${orgPeriodEnd}`
                  : 'per the register'
                : noRegistrationNumber
                  ? 'no charity number'
                  : 'not captured'
            }
          />
          {/* Always empty today, and that is the honest state rather than an omission:
              no Charity Commission endpoint publishes reserves (checked against the
              live API, see `OrganisationProfile.unrestrictedReserves`), so the only
              source is the application form. Shown rather than hidden so the gap is
              visible to the people deciding whether to add the question. */}
          <MiniKpi
            tint={KPI.reserves}
            icon={SafeBoxIcon}
            label="Unrestricted reserves"
            value={
              orgReserves != null ? (
                <CompactMoney amount={orgReserves} label="Exact reserves" />
              ) : (
                '—'
              )
            }
            sub={
              orgReserves != null
                ? reserveMonths != null
                  ? `~${reserveMonths} months' spend`
                  : 'as stated'
                : 'not asked on the form'
            }
          />
          {/* The deprivation panel that used to sit in the sidebar. */}
          <MiniKpi
            tint={KPI.community}
            icon={UserGroup02Icon}
            label="Community context"
            value={depResolved ? `Decile ${deprivation.min}–${deprivation.max}` : '—'}
            sub={
              depResolved
                ? [deprivation.vintage, region].filter(Boolean).join(' · ')
                : 'no delivery area'
            }
          />
        </div>

        {/* Application budget */}
        <Panel label="Application budget">
          <PanelTitle>Application budget</PanelTitle>
          {budgetLines.length > 0 ? (
            <>
              <div className="mb-3 flex items-baseline justify-between">
                <span
                  className="font-display text-heading font-medium leading-none"
                  style={{ color: C.ink }}
                >
                  {fmtMoney(budgetTotal)}
                </span>
                <span className="font-display text-body" style={{ color: C.sub }}>
                  {budgetLines.length} line{budgetLines.length !== 1 ? 's' : ''}
                </span>
              </div>
              <BarMeter
                bars={120}
                height={24}
                barWidth={3}
                className="mb-4 w-full"
                segments={budgetLines.map((l, i) => ({
                  value: l.amount,
                  colour: budgetColours[i]!,
                }))}
              />
              <div className="flex flex-col gap-2.5">
                {budgetLines.map((l, i) => {
                  const pct = budgetTotal > 0 ? Math.round((l.amount / budgetTotal) * 100) : 0
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span
                        className="size-2 shrink-0 rounded-swatch"
                        style={{ backgroundColor: budgetColours[i] }}
                      />
                      <div
                        className="min-w-0 flex-1 font-display text-body"
                        style={{ color: C.ink }}
                      >
                        <TruncatedText text={l.item} label="Budget line" />
                      </div>
                      <span
                        className="w-24 text-right font-display text-body font-medium tabular-nums"
                        style={{ color: C.ink }}
                      >
                        {fmtMoney(l.amount)}
                      </span>
                      <span
                        className="w-10 text-right font-display text-body tabular-nums"
                        style={{ color: C.faint }}
                      >
                        {pct}%
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          ) : budgetLink ? null : (
            <p className="font-display text-body" style={{ color: C.sub }}>
              No budget breakdown was provided with this application.
            </p>
          )}
          {budgetLink && (
            <div className={budgetLines.length > 0 ? 'mt-3 border-t pt-3' : ''}>
              <a
                href={budgetLink}
                target="_blank"
                // Applicant-supplied URL: never hand the opener to it.
                rel="noopener noreferrer"
                className="font-display text-body underline underline-offset-2"
                style={{ color: C.ink }}
              >
                {budgetLinkName}
              </a>
              <p className="mt-1 font-display text-body" style={{ color: C.sub }}>
                The applicant supplied their budget as a document. It opens in a new tab and isn't
                read by Custodian, so it doesn't feed the breakdown or the score.
              </p>
            </div>
          )}
        </Panel>

        {/* Due diligence checks */}
        <Panel>
          <PanelTitle
            right={
              <div className="flex items-center gap-3">
                <span className="hidden font-display text-label md:inline" style={{ color: C.sub }}>
                  These checks feed the due diligence marks shown in the applications list.
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRerunDD}
                  disabled={rerunningDD}
                >
                  {rerunningDD ? 'Re-running…' : 'Re-run'}
                </Button>
              </div>
            }
          >
            Due diligence checks
          </PanelTitle>
          {ddRecords.length > 0 ? (
            <div className="flex flex-col gap-1">
              {visibleDdRecords.map((r, i) => {
                const def = CHECK_DEFINITIONS[r.key]
                const ok = r.result === 'pass'
                const failed = r.result === 'fail'
                const colour = ok ? C.brand : failed ? C.danger : C.faint
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-chip p-3"
                    style={{ backgroundColor: C.wash }}
                  >
                    <span
                      className="font-display text-label font-medium"
                      style={{ color: failed ? C.danger : C.ink700 }}
                    >
                      {def?.label ?? r.key}
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-1 font-display text-label font-medium"
                      style={{ color: colour }}
                    >
                      <HugeiconsIcon
                        icon={failed ? Alert02Icon : Tick01Icon}
                        size={16}
                        color={colour}
                      />
                      {r.detail ?? (ok ? 'Clear' : failed ? 'Flagged' : 'Unverified')}
                    </span>
                  </div>
                )
              })}
              {passedDdCount > 0 && (
                <div className="pt-1">
                  <Disclosure
                    open={showAllDd}
                    onToggle={() => setShowAllDd((v) => !v)}
                    showLabel={`Show ${passedDdCount} passed ${passedDdCount === 1 ? 'check' : 'checks'}`}
                    hideLabel={`Hide ${passedDdCount} passed ${passedDdCount === 1 ? 'check' : 'checks'}`}
                  />
                </div>
              )}
            </div>
          ) : noRegistrationNumber ? (
            // "Not screened yet" reads as pending. When there is no registration
            // number it isn't pending — there is nothing to screen against, and
            // re-running will never change that. Say which, and offer the only thing
            // that does: supplying the number here, which screens on the spot.
            <ScreenWithNumber
              applicationId={application.id}
              canEdit={user.role === 'admin' || user.role === 'superadmin'}
            />
          ) : (
            <p className="font-display text-body" style={{ color: C.sub }}>
              Not screened yet.
            </p>
          )}
        </Panel>

        {/* Trustee vote — only once shortlisted (a vote precedes an award). */}
        {isShortlisted && (
          <Panel>
            <VotingSection applicationId={application.id} userId={user.id} userRole={user.role} />
          </Panel>
        )}

        {/* Not captured — the one place a silently-lost field becomes visible. */}
        {gaps.any && (
          <Panel label="Not captured">
            <PanelTitle>Not captured</PanelTitle>
            <p className="mb-2.5 font-display text-body" style={{ color: C.sub }}>
              This submission didn't include the following, so the features that use them are
              unavailable on this application.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ...[...gaps.oneOf, ...gaps.expectedGroups].map((g) => ({
                  key: g.keys.join('-'),
                  label: g.label.replace(/^./, (ch) => ch.toUpperCase()),
                  degrades: g.degrades,
                })),
                ...gaps.expected.map((g) => ({
                  key: g.key,
                  label: g.label,
                  degrades: g.degrades,
                })),
              ].map((g) => (
                <div
                  key={g.key}
                  className="rounded-chip px-3 py-2.5"
                  style={{ backgroundColor: C.wash }}
                >
                  <div className="font-display text-body" style={{ color: C.ink }}>
                    {g.label}
                  </div>
                  <div className="mt-0.5 font-display text-label" style={{ color: C.sub }}>
                    {g.degrades}
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="text"
              size="xs"
              onClick={() => setSubmissionOpen(true)}
              className="mt-2.5"
            >
              Check the submission →
            </Button>
          </Panel>
        )}

        {/* Comments */}
        <Panel label="Comments">
          <CommentsSection applicationId={application.id} userId={user.id} userRole={user.role} />
        </Panel>
      </div>

      <ApplicationSubmissionDialog
        application={application}
        programmeName={application.roundProgramme.programme.name}
        open={submissionOpen}
        onClose={() => setSubmissionOpen(false)}
      />
    </div>
  )
}
