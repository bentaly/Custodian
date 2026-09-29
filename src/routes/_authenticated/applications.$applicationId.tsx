import { createFileRoute, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { parseApplicationsSearch } from '../../lib/listSearch'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Coins01Icon,
  CoinsSwapIcon,
  PencilEdit01Icon,
  UserGroupIcon,
  UserGroup02Icon,
  Building02Icon,
  MoneyReceive01Icon,
  SafeBoxIcon,
  File01Icon,
  Mail01Icon,
  Alert02Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons'
import {
  getApplication,
  rerunDueDiligence,
  setAmendedAmount,
  updateApplicationStatus,
} from '../../server/fns/applications'
import { ApplicationSubmissionDialog } from '../../components/ApplicationSubmissionDialog'
import { EditableSlot } from '../../components/applications/edit/EditableSlot'
import { EditedMark } from '../../components/applications/edit/EditedMark'
import { ThemesEditor } from '../../components/applications/edit/ThemesEditor'
import { AnswerPickerDialog } from '../../components/applications/edit/AnswerPickerDialog'
import { BudgetEditor } from '../../components/applications/edit/BudgetEditor'
import {
  FieldEditor,
  describeOutcome,
  type EditOutcome,
} from '../../components/applications/edit/FieldEditor'
import { rescore } from '../../server/fns/applicationEdits'
import { RefreshLink } from '../../components/RefreshLink'
import { isEditableField, type EditableField } from '../../lib/applicationEdit'
import { isUnnamedOrganisation } from '../../lib/organisationName'
import { AmountDialog, type AmountChange } from '../../components/AmountDialog'
import { amendmentPercent } from '../../lib/amendedAmount'
import { CommentsSection } from '../../components/CommentsSection'
import { ProgressBar } from '../../components/ProgressBar'
import { BarMeter, withAlpha } from '../../components/BarMeter'
// DetailHeader / Panel / PanelTitle are the shared detail-screen furniture (`ui/Detail`),
// which this screen's grant and report siblings wear too.
import {
  BreadcrumbBar,
  Button,
  Dialog,
  CompactMoney,
  DetailHeader,
  KPI_TINTS,
  MiniKpi,
  Panel,
  PanelTitle,
  RelatedLink,
  Tooltip,
  TruncatedText,
  ThemePill,
  useClamp,
  ClampToggle,
} from '../../components/ui'
import { ScoreRing } from '../../components/charts/ScoreRing'
import { AREA_ICON } from '../../components/Sidebar'
import {
  CRITERION_DEFINITIONS,
  CRITERION_ORDER,
  type CustodianScoreDetail,
} from '../../lib/custodianScore'
import { applicationStatusLabel } from '../../lib/validators/application'
import { impactUnitLabel, impactUnitSingular } from '../../lib/impactUnits'
import {
  CHECK_DEFINITIONS,
  charityRegisterUrl,
  type DueDiligenceCheckRecord,
} from '../../lib/dueDiligence'
import { MAILTO_LINK, mailtoHref } from '../../lib/mailto'
import { fieldGaps, missingRegistrationNumber } from '../../lib/fieldMapping/gaps'
import { useRemembered } from '../../lib/useRemembered'
import type { DeprivationContext } from '../../lib/deprivation/types'
import { deliveryAreaLabel, formatDecileRange } from '../../lib/deprivation/types'
import type { OrganisationProfile } from '../../lib/dueDiligence'
import type { BudgetLine } from '../../lib/budget/types'
import { budgetDocumentName } from '../../lib/budget/link'
import { fmtDate, fmtDuration, fmtMoney, fmtPerYear, fmtRef } from '../../lib/format'
import { colourSeries } from '../../lib/programmeColours'
import { C as TOKENS, bandForScore } from '../../components/ui/tokens'

export const Route = createFileRoute('/_authenticated/applications/$applicationId')({
  // This screen has no search state of its own. What it validates is the LIST's — round,
  // programme, status, sort, page — carried in by the row that was clicked, so the back
  // arrow can return the reader to the list they left rather than a defaulted one. It is
  // read by nothing else here; parsing it is what keeps it in the URL across a reload.
  validateSearch: parseApplicationsSearch,
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
// its last card mixed an `info` fill with a `sky` accent. Keyed in the order the cards
// RENDER: a tint is a place in the row, so moving a card means moving its tint too.
const KPI = {
  amount: KPI_TINTS.violet,
  proposed: KPI_TINTS.green,
  area: KPI_TINTS.amber,
  income: KPI_TINTS.pink,
  reserves: KPI_TINTS.sky,
  // Six cards, five tints: the row starts the list again rather than inventing a sixth.
  community: KPI_TINTS.violet,
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
 * The register's credit line, as a link to the entry itself where we can address one.
 *
 * The facts under it are a dated snapshot of a public record, so the officer reading
 * them should be one click from the record. `url` is null for a charity screened
 * before the organisation number was captured (the register's URLs take that, not the
 * charity number) — then this states the source and links nowhere, which is the honest
 * answer rather than a guessed URL that 404s in front of a foundation.
 */
function RegisterCredit({ url, children }: { url: string | null; children: React.ReactNode }) {
  if (!url) return <>{children}</>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
      title="Open this entry on the Charity Commission register"
    >
      {children}
    </a>
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
        {value ?? empty ?? '--'}
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
 * registration number can never be screened: the checks read the same empty columns
 * and return "not screened" however often they run.
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
        Not screened. This application has no charity number or company number, so there is no
        register to check it against.
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
            Give whichever the organisation holds; either alone is enough. The checks run
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
        // Every `href` this takes is a mailto; see `lib/mailto` for why a new tab.
        {...MAILTO_LINK}
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
  /* Not this screen's state — the list's, riding through so the back arrow can restore
     it. `{}` when the reader arrived from anywhere else. */
  const listSearch = Route.useSearch()
  const router = useRouter()
  // Remembered across reloads: a reviewer who works with the passed checks open should
  // not re-open them every morning. Keyed on the PANEL, never on the application —
  // per-row keys would accumulate one per application ever opened and never be cleared.
  const [showAllDd, setShowAllDd] = useRemembered('application.dd-passed', false)
  const [showAllFlags, setShowAllFlags] = useRemembered('application.flags-all', false)
  const [shortlisting, setShortlisting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submissionOpen, setSubmissionOpen] = useState(false)
  // The amount dialog: the proposed award and this year's share of it, asked when
  // shortlisting against an enforced budget and offered on the Amount proposed card.
  const [amountOpen, setAmountOpen] = useState(false)
  const [amountMode, setAmountMode] = useState<'shortlist' | 'edit'>('shortlist')
  // What the last edit did ("Saved. The AI assessment is being re-run."), shown above
  // the body until the next one or a reload.
  // What the last edit did ("Saved. The AI assessment is running now."), shown above the
  // body until the next one or a reload. `refresh` offers the Refresh link beside it.
  const [notice, setNotice] = useState<{ text: string; refresh: boolean } | null>(null)
  // The field the answer picker is open for, from any edit surface on the screen.
  const [pickingField, setPickingField] = useState<EditableField | null>(null)
  // The fields a "Fill in" dialog is open for, from the Not captured panel.
  const [adding, setAdding] = useState<EditableField[] | null>(null)
  const [addingBudget, setAddingBudget] = useState(false)
  const [rescoring, setRescoring] = useState(false)

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
  // This year's cash already drawn from the round, EXCLUDING this application — the same
  // basis the shortlist meter and the server's ceiling use (`roundProgrammeSpend`). A
  // round budget counts what has to be paid this year, not the whole commitment, so what
  // this application adds is its first year's share and not its full ask.
  const committedThisYear = application.roundProgrammeCommittedThisYear
  const amountRequested =
    application.amountRequested === null ? null : parseFloat(application.amountRequested)
  // What would be awarded: the officer's proposal where there is one, else the ask.
  const amountAmended =
    application.amountAmended === null ? null : parseFloat(application.amountAmended)
  const effective = application.effectiveAmount
  // A proposal can be made from arrival until a decision is final: not once declined
  // (nothing to fund) or awarded (the award is the record). Not locked by votes, unlike
  // the fields' pencils: changing the figure after the board has talked is the point.
  const canPropose =
    (user.role === 'admin' || user.role === 'superadmin') &&
    amountRequested !== null &&
    application.status !== 'awarded' &&
    application.status !== 'declined'
  const firstYear = application.firstYearAmount
  const fyLabel = application.roundFinancialYear.label
  const budgetRemaining = budget === null ? null : budget - committedThisYear
  // "Budget full" only exists for a foundation that has asked for it
  // (`client_profiles.enforce_round_budget`, default off). With the ceiling off the
  // round-programme budget is a target: shortlisting past it is allowed, and the
  // shortlist's proposed-spend bar is what says how far over the round has gone.
  const isBudgetFull =
    application.enforceRoundBudget &&
    !isShortlisted &&
    budget !== null &&
    committedThisYear + (firstYear ?? 0) > budget

  const scoreStatus = application.custodianScoreStatus ?? 'pending'
  const score = application.custodianScore
  const scoreDetail = application.custodianScoreDetail as CustodianScoreDetail | null
  const scored = scoreStatus === 'scored' && score != null && scoreDetail != null
  // Not while the assessment is WAITING (the amount was cleared): what is on the row then is
  // the previous run's reading of an application that has since changed, and showing it
  // under "waiting for the amount" presents an old verdict as the current one.
  const grantPurpose =
    application.custodianScoreStatus === 'waiting' ? null : application.grantPurpose?.trim() || null
  // Picked by the same model call as the purpose (or taken from an import), or chosen by
  // an admin (`themes_set_by`). Null is "not assigned yet". Hidden while waiting for the
  // same reason as the purpose, unless a PERSON chose them, which stand regardless.
  const themes =
    application.custodianScoreStatus === 'waiting' && !application.themesSetBy
      ? null
      : application.themes

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
  const region = deliveryAreaLabel(application)

  const budgetLines = (application.budgetBreakdown as BudgetLine[] | null) ?? []
  const budgetTotal = budgetLines.reduce((s, l) => s + l.amount, 0) || (amountRequested ?? 0)
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
  // Of the amount that would be AWARDED, so a proposal moves it: the cost of each
  // beneficiary is a question about the foundation's money, not the applicant's ask.
  const costPerBeneficiary =
    proposedImpact && proposedImpact > 0 && effective != null ? effective / proposedImpact : null

  // What this submission never captured. A field that didn't map leaves a null column,
  // indistinguishable from a question the foundation never asked — so the feature it
  // feeds silently doesn't run. Stating it is the difference between noticing in the
  // queue and noticing weeks later, if at all.
  // "Unnamed (ref …)" is a stand-in, not a name: it counts as not captured.
  const unnamed = isUnnamedOrganisation(application.organisationName)
  const gapValues = {
    charityNumber: application.charityNumber,
    companyNumber: application.companyNumber,
    deliveryArea: application.deliveryArea,
    // The register's own description of the charity answers the same question well enough,
    // and it is what the organisation card shows in its place: no complaint when it is there.
    organisationSummary:
      application.organisationSummary ??
      (application.organisationProfile as OrganisationProfile | null)?.activities ??
      null,
    unrestrictedReserves: application.unrestrictedReserves,
    budgetBreakdown: budgetLines,
    budgetBreakdownLink: application.budgetBreakdownLink,
    proposedImpactQuantity: application.proposedImpactQuantity,
    amountRequested: application.amountRequested,
    organisationName: unnamed ? null : application.organisationName,
    applicantEmail: application.applicantEmail,
    // From the server's unredacted row, so a trustee is not told the bank details are
    // missing merely because they are withheld from them.
    bankAccountName: application.bankDetailsComplete ? 'held' : null,
    bankAccountNumber: application.bankDetailsComplete ? 'held' : null,
    bankSortCode: application.bankDetailsComplete ? 'held' : null,
  }
  const gaps = fieldGaps(gapValues)
  const noRegistrationNumber = missingRegistrationNumber(gapValues)
  // Gaps that hold up a later step, minus the amount (which has its own card, and which
  // the assessment says it is waiting for). Listed under "Not captured".
  const laterGaps = gaps.toFill.filter((g) => !g.keys.includes('amountRequested'))

  // ── Editing ────────────────────────────────────────────────────────────────
  // What an edit surface starts from: the application's current values, by field.
  const canEdit = application.canEdit
  const edits = application.edits
  const editValues: Partial<Record<EditableField, string | null>> = {
    organisationName: unnamed ? null : application.organisationName,
    applicantEmail: application.applicantEmail,
    charityNumber: application.charityNumber,
    companyNumber: application.companyNumber,
    amountRequested: application.amountRequested,
    proposedImpactQuantity: application.proposedImpactQuantity,
    deliveryArea: application.deliveryArea,
    bankName: application.bankName,
    bankAccountName: application.bankAccountName,
    bankAccountNumber: application.bankAccountNumber,
    bankSortCode: application.bankSortCode,
  }
  const hasSubmission = application.submission !== null
  // An answer the submission gave for a field the application has no value for: SENT,
  // but it could not be read (an amount of "£2,500-5,000", an email typed in words).
  // Said as such, because "not captured" alone reads as a question never asked, which
  // is the lost-field bug this whole panel exists to prevent. Quoted short.
  const unreadAnswer = (keys: string[]): string | null => {
    const answer = application.submission?.find(
      (a) => a.canonical !== null && keys.includes(a.canonical),
    )?.value
    if (!answer) return null
    const oneLine = answer.replace(/\s+/g, ' ').trim()
    return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine
  }
  // A reason Re-run is unavailable that is worth SAYING: the cap, or a vote already cast.
  const shownBlocker =
    application.rerunBlocked &&
    (application.rerunBlocked.code === 'capped' || application.rerunBlocked.code === 'voted')
      ? application.rerunBlocked
      : null
  // A card's figure with its "Edited" mark beside it, where somebody changed it. Beside
  // the FIGURE rather than on the line under it, because that line truncates and the
  // mark was the part being cut off.
  const withMark = (value: ReactNode, field: string): ReactNode =>
    edits.some((e) => e.field === field) ? (
      <span className="inline-flex items-baseline gap-2">
        {value}
        <EditedMark field={field} edits={edits} />
      </span>
    ) : (
      value
    )
  // The organisation card edits four facts together, so it wears one mark: the latest.
  const orgEditField =
    [...edits]
      .reverse()
      .find((e) =>
        ['organisationName', 'charityNumber', 'companyNumber', 'applicantEmail'].includes(e.field),
      )?.field ?? null
  // "The AI assessment is running now. Refresh" has done its job once a refresh shows it
  // finished: take it away rather than leave it claiming something still running.
  useEffect(() => {
    if (notice?.refresh && scoreStatus !== 'queued') setNotice(null)
  }, [notice, scoreStatus])
  const onSaved = (outcome: EditOutcome) =>
    setNotice({ text: describeOutcome(outcome), refresh: outcome.scoreQueued })
  // "Choose from their answers", offered under every field where the application came in
  // through a form. Undefined without one: there are no answers to choose from.
  const chooseAnswer = hasSubmission ? (field: EditableField) => setPickingField(field) : undefined
  const waiting = scoreStatus === 'waiting'
  // The purpose and themes are on their way (or waiting to be): the column stays, saying so,
  // rather than the panel jumping when the model answers.
  const purposeComing = !grantPurpose && (waiting || scoreStatus === 'queued')
  // Assessed, and the model found no clear activity to state: it returns no purpose rather
  // than a hedged one, and the screen says so in our own words.
  const purposeUnclear = !grantPurpose && scoreStatus === 'scored'

  // ── What the register says the applicant IS ────────────────────────────────
  // Captured by `runDueDiligence` on the same calls the checks come from, so this
  // costs no extra screening — see `OrganisationProfile`. Null whenever there was
  // nothing to read: no charity number, a Scottish charity, or a company-only
  // applicant. That distinction is stated rather than left as an em dash, because a
  // blank figure and an unasked question must never look the same.
  const orgProfile = (application.organisationProfile as OrganisationProfile | null) ?? null
  // Null until this application has been screened since the organisation number
  // started being captured — the credit line then names the register without linking.
  const registerUrl = charityRegisterUrl(orgProfile?.organisationNumber)
  // Who they are, in the applicant's own words, where the foundation's form asked. It
  // DISPLACES the register's activity summary rather than sitting beside it: both
  // answer the same question, and printing two descriptions of one charity leaves a
  // reader deciding which to believe. This one wins because it was written for this
  // funder and this ask, where the register's was filed against an annual return up to
  // eighteen months ago — but the register's stays as the fallback, since it is all
  // there is for a foundation whose form never asks.
  const orgSummary = application.organisationSummary?.trim() || null
  // Whether the description overflows its two lines, and the open/closed state of the
  // chevron that reveals the rest. Measured, not guessed — see `useClamp`. Keyed on
  // whichever description is being SHOWN, so the applicant's longer prose is clamped
  // on its own length rather than the register's.
  const activities = useClamp(orgSummary ?? orgProfile?.activities)
  const orgIncome = orgProfile?.latestIncome ?? null
  // The applicant's own figure, and the only one there has ever been: no Charity
  // Commission endpoint publishes reserves (verified against the live API — see
  // `OrganisationProfile.unrestrictedReserves`), so that half of the chain has always
  // read null. It is kept rather than deleted because it is where a register figure
  // would arrive if one ever existed, and it must not overrule what the applicant said.
  const orgReserves =
    application.unrestrictedReserves != null
      ? parseFloat(application.unrestrictedReserves)
      : (orgProfile?.unrestrictedReserves ?? null)
  const reservesFromApplication = application.unrestrictedReserves != null
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
  // yet is not the same as an applicant there is nothing to screen — and neither is the
  // same as screening that DID run, before the register's figures were kept (the
  // profile arrived after due diligence did, so every application screened before then
  // has checks and no profile). Saying "not run" there contradicts the due diligence
  // verdict on the same screen.
  const orgAbsence = noRegistrationNumber
    ? 'No charity or company number was captured, so there is no register entry to read.'
    : application.charityNumber
      ? application.dueDiligenceCheckedAt
        ? "The register checks ran before Custodian kept the register's own figures, so there is nothing to show for this application yet."
        : 'Not read yet. The register checks have not run for this application.'
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

  /**
   * Shortlisting only ASKS how much falls in this year when the answer gates something.
   *
   * With the round budget as a target — the default — an estimate that is a little out
   * makes the shortlist meter a little approximate and blocks nobody, so a dialog in front
   * of every shortlisting would be a question asked for our benefit rather than theirs.
   * The figure is still correctable afterwards, from the amount card on this screen.
   *
   * With `enforce_round_budget` ON it stops being an estimate: it decides whether this
   * application can be shortlisted at all, and a foundation refused on a figure nobody was
   * shown would have no way to see why. So that is exactly when we ask.
   *
   * Un-shortlisting never asks. The question has no answer on the way out, the stored
   * figure is cleared, and a confirmation would be friction on an undo.
   */
  const handleShortlist = () => {
    if (isShortlisted) {
      return act(setShortlisting, () =>
        updateApplicationStatus({ data: { id: application.id, status: 'for_review' } }),
      )
    }
    if (!application.enforceRoundBudget) {
      return act(setShortlisting, () =>
        updateApplicationStatus({ data: { id: application.id, status: 'shortlisted' } }),
      )
    }
    setAmountMode('shortlist')
    setAmountOpen(true)
  }
  /**
   * The dialog's answer. A change is written first (`setAmendedAmount`, which posts its
   * comment and audit row), then shortlisting runs its own ceiling on the stored figures.
   * Errors are thrown back to the dialog so it stays open and says what went wrong.
   */
  async function confirmAmount(change: AmountChange) {
    if (change.changed) {
      await setAmendedAmount({
        data: {
          id: application.id,
          amount: change.amount,
          firstYearAmount: change.firstYearAmount,
          note: change.note || undefined,
        },
      })
    }
    if (amountMode === 'shortlist') {
      await updateApplicationStatus({ data: { id: application.id, status: 'shortlisted' } })
    }
    await router.invalidate()
  }
  const handleDecline = () =>
    act(setDeclining, () =>
      updateApplicationStatus({
        data: { id: application.id, status: isDeclined ? 'for_review' : 'declined' },
      }),
    )

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
      {/* The crumb is the same gesture as the back arrow below it, so it carries the
          same list state — two ways out that land in two different places would be
          worse than one. Opposite it, the grant this application became: onward
          NAVIGATION lives on this row on every detail screen, never among the header's
          actions — see `RelatedLink`. */}
      <BreadcrumbBar
        items={[
          { label: 'Applications', to: '/applications', search: listSearch },
          { label: application.organisationName },
        ]}
        related={
          awardId ? (
            <RelatedLink to="/awards/$awardId" params={{ awardId }} icon={AREA_ICON['/awards']}>
              Award
            </RelatedLink>
          ) : undefined
        }
      />

      {/* Header — Figma 435:38405, now the shared `DetailHeader` the grant and report
          screens wear too. The decision buttons live here rather than in a sidebar, so
          the whole page is one full-width column. */}
      <DetailHeader
        backTo="/applications"
        /* Back to the LIST AS IT WAS — the round and programme being read, the status
           filter, the sort, the page. Sending `{ roundId: undefined }` instead dropped
           all of it, and the list then redirected to its default round, so going back
           from an application in an older round silently moved the reader to a
           different one. Empty when the reader arrived from anywhere but the list
           (the dashboard, a grant, search), which lands on the plain list as before. */
        backSearch={listSearch}
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
                    href={mailtoHref(application.applicantEmail, {
                      subject: `Your application to ${clientName ?? 'us'}${
                        application.externalApplicationId
                          ? ` (${application.externalApplicationId})`
                          : ''
                      }`,
                    })}
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
            {/* Awarded is terminal *here*: `updateApplicationStatus` refuses to move an
                application with a live award row, so a status button or dropdown in this
                slot would be a control that can only ever error. So an awarded
                application simply has no decision buttons — the grant it became is one
                row up, on the breadcrumb, with the header's status pill already saying
                "Awarded". That pill is why the slot needs nothing of its own: it used to
                hold a green "Awarded" chip for the not-yet-backfilled case, which was the
                same word twice on one line. */}
            {!isAwarded && canSetStatus && (
              <>
                {/* No Decline once an application is SHORTLISTED. Shortlisting is a
                    decision the round has already recorded — it commits the ask to the
                    round's pipeline meter and it is what opens trustee voting — so
                    declining straight from it retracts all of that in one click, from a
                    button sitting next to the one that undoes the shortlisting
                    properly. The way out is Remove from shortlist, then Decline: two
                    steps, each of which says what it does. (It is not a permission —
                    the server still accepts shortlisted → declined, which is what the
                    list's bulk decline uses.) */}
                {!isShortlisted && (
                  <HeaderButton tone="danger" onClick={handleDecline} disabled={declining}>
                    {declining ? '…' : isDeclined ? 'Reinstate to review' : 'Decline'}
                  </HeaderButton>
                )}
                {/* And no Shortlist once an application is DECLINED — the mirror of the
                    rule above, for the same reason. Declining is a recorded decision;
                    shortlisting straight out of it would reverse that decision and
                    commit the ask to the round's pipeline in one click, from a button
                    sitting beside the one that reverses it properly. Reinstate to
                    review, then Shortlist: two steps, each saying what it does. Also not
                    a permission — the server still accepts declined → shortlisted. */}
                {/* The reason a button is DISABLED is the one explanation a `title`
                    can never deliver: a disabled button takes no focus, so a keyboard
                    user has no way to reach it, and several browsers decline to draw
                    the tip at all. So when the budget is full the button is wrapped in
                    the tooltip's own focusable trigger — which is a tab stop precisely
                    because the button it wraps is not. When the button is live it
                    wears nothing, and stays the single tab stop it should be. */}
                {!isDeclined &&
                  (() => {
                    // No amount, no shortlisting: every figure the shortlist feeds would
                    // read it as £0. Same tooltip treatment as a full budget.
                    const noAmount = !isShortlisted && amountRequested === null
                    const shortlistButton = (
                      <HeaderButton
                        tone={isShortlisted ? 'plain' : 'primary'}
                        onClick={handleShortlist}
                        disabled={shortlisting || isBudgetFull || noAmount}
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
                    return noAmount ? (
                      <Tooltip label="Why shortlisting is unavailable" trigger={shortlistButton}>
                        Fill in the amount requested first.
                      </Tooltip>
                    ) : isBudgetFull ? (
                      <Tooltip label="Why shortlisting is unavailable" trigger={shortlistButton}>
                        Budget committed. No funds remaining in this programme.
                      </Tooltip>
                    ) : (
                      shortlistButton
                    )
                  })()}
              </>
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

      {notice && (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-chip border px-3 py-2 font-display text-body"
          style={{ borderColor: C.brandBorder, backgroundColor: C.brandWash, color: C.ink }}
        >
          <span>
            {notice.text}
            {notice.refresh && (
              <>
                {' '}
                <RefreshLink />
              </>
            )}
          </span>
          <button
            type="button"
            className="shrink-0 font-display text-label underline"
            style={{ color: C.sub }}
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-col gap-4">
        {/* What the money would fund — stated before anything we made of it. Its own
            panel rather than a line inside the assessment below, because it is a
            statement of fact carrying no judgement, and because it is present on rows
            the score is missing from (an imported grant, a failed scoring run). */}
        {/* The scoring call's summary of the ask. The grant it becomes carries its OWN purpose — what
            the foundation agreed to fund, written at award set-up and printed on the
            letter — shown as the grant screen's "Grant purpose". That one is prefilled
            from this one and then edited, so the two differ on most grants. */}
        {(grantPurpose ||
          purposeComing ||
          purposeUnclear ||
          canEdit ||
          orgProfile ||
          orgSummary ||
          noRegistrationNumber) && (
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
            <div
              className={
                grantPurpose || purposeComing || purposeUnclear
                  ? 'grid gap-6 lg:grid-cols-2 lg:gap-8'
                  : ''
              }
            >
              {/* A column, so the caption can be pushed to the FOOT of it. The grant
                  purpose is capped at 40 words and the organisation card runs to five
                  rows, so the left column always bottoms out first and left a hole under
                  it. Sinking the caption spends that gap on something real and keeps the
                  two section labels on the same line, which centring the column would
                  have broken. Below `lg` the columns stack and `mt-auto` is inert, so
                  the caption goes back to hugging the sentence it qualifies. */}
              {(grantPurpose || purposeComing || purposeUnclear) && (
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
                  {grantPurpose ? (
                    <p
                      className="mt-2 border-l-3 pl-2 font-display text-title leading-normal"
                      style={{ color: C.ink, borderColor: C.brand }}
                    >
                      {grantPurpose}
                    </p>
                  ) : purposeUnclear ? (
                    <p
                      className="mt-2 border-l-3 pl-2 font-display text-body leading-normal"
                      style={{ color: C.sub, borderColor: C.line }}
                    >
                      The application does not say clearly what the money is for. See the AI
                      assessment below.
                    </p>
                  ) : (
                    // The same model call writes the purpose, the themes and the score,
                    // so while the assessment waits for the amount there is no purpose
                    // yet. Said so, with the way to read the application meanwhile.
                    <p
                      className="mt-2 border-l-3 pl-2 font-display text-body leading-normal"
                      style={{ color: C.sub, borderColor: C.line }}
                    >
                      {waiting
                        ? 'Written by the AI assessment, which is waiting for the amount requested. Until then, '
                        : 'Being written by the AI assessment now; it usually takes under a minute. Meanwhile, '}
                      <button
                        type="button"
                        className="underline"
                        style={{ color: C.brand }}
                        onClick={() => setSubmissionOpen(true)}
                      >
                        View Submission
                      </button>{' '}
                      has the application in their own words.
                    </p>
                  )}
                  {/* Beside the purpose because they come from the same reading of the
                      application. An admin may choose them by hand (from the programme's
                      list), and the assessment then keeps their choice. Nothing at all
                      while unassigned and not editable, rather than the programme's whole
                      list. */}
                  <ThemesEditor
                    applicationId={application.id}
                    themes={themes}
                    programmeThemes={programme.tags ?? []}
                    canEdit={canEdit}
                    lockedReason={application.editLocked}
                    edits={edits}
                    waiting={waiting}
                  />
                  {/* The one line of copy on this panel that has to be exactly right.
                      `grantPurpose` is written by the scoring model (see
                      `CustodianScoreOutputSchema` — one or two sentences, 40 words, no
                      judgement), NOT quoted from the applicant. Captions calling it "the
                      applicant's own words" were drafted for this panel and are false:
                      the whole point of giving it this much weight is that a reader can
                      trust what it says it is. The 40-word cap is also what keeps it to
                      a few lines — free text with a column to itself runs to a wall. */}
                  {grantPurpose && (
                    <p
                      className="mt-3 font-display text-label lg:mt-auto lg:pt-6"
                      style={{ color: C.sub }}
                    >
                      Summarised from the application
                    </p>
                  )}
                </div>
              )}

              {/* Who they are, beside what they would do with the money. The tint marks
                  a change of source, not a decoration: nothing in this block is the
                  scoring model's reading of the application, which is what everything
                  else on this panel is. It was one source when it was built — all of it
                  the register — and now it is two, because the description gives way to
                  the applicant's own words where the form asked for them. So the
                  provenance sits per block: a byline on the description, and the register
                  credited under the facts, which remain entirely its. */}
              <EditableSlot
                canEdit={canEdit}
                lockedReason={application.editLocked}
                label="Edit the organisation's details"
                applicationId={application.id}
                fields={['organisationName', 'charityNumber', 'companyNumber', 'applicantEmail']}
                values={editValues}
                onSaved={onSaved}
                onChooseAnswer={chooseAnswer}
                hint="A changed charity or company number is screened against the register again when you save."
              >
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
                    {orgEditField && <EditedMark field={orgEditField} edits={edits} />}
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
                      card back the line it was spending.

                      It names the source of the DESCRIPTION under it, not of the card.
                      The card was one source when it was built — everything in it came
                      off the register, which is what the tint marks — and the applicant's
                      own summary broke that: a byline reading "Charity Commission" over a
                      paragraph the applicant wrote is the exact confusion the tint exists
                      to prevent. The register keeps its credit on the facts below, which
                      are still entirely its. */}
                    {(orgSummary || orgProfile) && (
                      <p
                        className="ml-auto font-display text-micro uppercase"
                        style={{ color: C.faint }}
                      >
                        {orgSummary ? (
                          'From the application'
                        ) : (
                          <>
                            <RegisterCredit url={registerUrl}>Charity Commission</RegisterCredit> ·
                            read {fmtDate(orgProfile!.fetchedAt)}
                          </>
                        )}
                      </p>
                    )}
                  </div>

                  {orgSummary || orgProfile?.activities ? (
                    // The applicant's own description where the form asked for one, and
                    // the charity's own description from its annual return otherwise —
                    // neither ours nor a model's either way, which is why this needs no
                    // hedge where the grant purpose beside it does. Length is uncontrolled
                    // (one sentence for a village hall, three thousand characters from an
                    // applicant with a lot to say), so it is clamped on DISPLAY rather than
                    // on write: truncating either before storing it would lose it for good.
                    // The chevron that opens it is up on the heading row, and appears only
                    // when there is something behind the fold.
                    <p
                      ref={activities.ref}
                      className={`mt-2 font-display text-body leading-relaxed ${activities.className ?? ''}`}
                      style={{ color: C.ink }}
                    >
                      {orgSummary ?? orgProfile!.activities}
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
                      {/* The one cell in here the register cannot fill: no Charity
                        Commission endpoint publishes reserves at all (verified against
                        the live API — see `OrganisationProfile.unrestrictedReserves`), so
                        the application form is the only source, and the note says so
                        rather than letting the figure borrow the card's register credit.
                        Empty still says which question went unanswered rather than
                        showing a dash, which would read as a charity that holds none. */}
                      <Fact
                        label="Unrestricted reserves"
                        value={
                          orgReserves != null ? (
                            <CompactMoney amount={orgReserves} label="Exact reserves" />
                          ) : null
                        }
                        empty="not captured"
                        note={
                          // Months of cover is the more useful half, so it leads; where it
                          // cannot be worked out (no register spend to divide by) the
                          // provenance stands alone rather than the cell going bare.
                          [
                            reserveMonths != null ? `~${reserveMonths} months' spend` : null,
                            reservesFromApplication ? 'stated on the form' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || null
                        }
                      />
                      {orgRegistered && <Fact label="Registered" value={orgRegistered} />}
                      {orgPeople && <Fact label="People" value={orgPeople} />}
                    </dl>
                  )}

                  {/* The register's credit, when the byline above is already spent naming
                    the applicant as the source of the description. One line per source,
                    each sitting with what it actually produced — and nothing printed
                    twice, which is why this is conditional rather than always on. */}
                  {orgSummary && orgProfile && (
                    <p
                      className="mt-3 font-display text-micro uppercase"
                      style={{ color: C.faint }}
                    >
                      Facts from the{' '}
                      <RegisterCredit url={registerUrl}>Charity Commission</RegisterCredit> · read{' '}
                      {fmtDate(orgProfile.fetchedAt)}
                    </p>
                  )}
                </div>
              </EditableSlot>
            </div>
          </Panel>
        )}

        {/* AI Assessment */}
        <Panel label="AI assessment">
          {/* Re-run appears only once something the assessment reads has been edited
              since it ran (or it failed), never after a trustee has voted, and at most
              five times in a day: `rerunBlocker` is the rule, on the server. An edit never
              re-runs it by itself, so a person can fix several things and then ask once.
              At the cap the button stays, disabled, saying why: vanishing would read as
              the edit not having registered. */}
          <PanelTitle
            right={
              !canEdit ? undefined : application.rerunBlocked === null ? (
                <Button
                  size="sm"
                  disabled={rescoring}
                  onClick={() =>
                    act(setRescoring, async () => {
                      await rescore({ data: { id: application.id } })
                      // Reload first, so the page already reads `queued` when the notice lands.
                      await router.invalidate()
                      setNotice({ text: 'The AI assessment is running now.', refresh: true })
                    })
                  }
                >
                  {rescoring ? 'Starting…' : 'Re-run assessment'}
                </Button>
              ) : shownBlocker ? (
                <Tooltip
                  label="Why re-running is unavailable"
                  trigger={
                    <Button size="sm" disabled>
                      Re-run assessment
                    </Button>
                  }
                >
                  {application.rerunBlocked.message}
                </Tooltip>
              ) : undefined
            }
          >
            AI Assessment
          </PanelTitle>
          {canEdit && scored && (application.rerunBlocked === null || shownBlocker) && (
            <p className="-mt-2 mb-4 font-display text-label" style={{ color: C.sub }}>
              {application.rerunBlocked === null
                ? 'The details have changed since this was assessed. Re-run it when you have finished editing.'
                : `The details have changed since this was assessed. ${application.rerunBlocked.message}`}
            </p>
          )}

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
          ) : waiting ? (
            // Held on purpose until the amount is in, so it marks the finished
            // application rather than a gappy one.
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-display text-body" style={{ color: C.sub }}>
                Waiting for the amount requested. The assessment runs as soon as it is filled in, so
                it marks the finished application rather than a gappy one.
              </p>
              {canEdit && hasSubmission && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPickingField('amountRequested')}
                >
                  Fill in the amount
                </Button>
              )}
            </div>
          ) : (
            <p className="font-display text-body" style={{ color: C.sub }}>
              {scoreStatus === 'error'
                ? 'Scoring failed. Try re-scoring.'
                : scoreStatus === 'queued'
                  ? 'AI is currently scoring this application. It usually takes under a minute.'
                  : 'This application has not been scored yet.'}
              {scoreStatus === 'queued' && (
                <>
                  {' '}
                  <RefreshLink />
                </>
              )}
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
                    onToggle={() => setShowAllFlags(!showAllFlags)}
                    showLabel={`Show ${hiddenFlagCount} more flag${hiddenFlagCount === 1 ? '' : 's'}`}
                    hideLabel="Show fewer flags"
                  />
                </div>
              )}
            </>
          )}
        </Panel>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 [&>*]:min-w-0">
          <EditableSlot
            canEdit={canEdit}
            lockedReason={application.editLocked}
            label="Edit the amount requested"
            applicationId={application.id}
            fields={['amountRequested']}
            values={editValues}
            onSaved={onSaved}
            onChooseAnswer={chooseAnswer}
            firstYear={
              application.firstYearSuggested !== null
                ? {
                    label: fyLabel,
                    stated: application.firstYearIsSuggested ? null : firstYear,
                    suggested: application.firstYearSuggested,
                  }
                : undefined
            }
          >
            <MiniKpi
              tint={KPI.amount}
              icon={Coins01Icon}
              label="Amount requested"
              /* Stated in full, never compacted. This is the one figure on the screen the
               card's own subline does arithmetic on ("£2,420 per year for 2 years"), and
               a headline that disagrees with the sum beneath it is read as an error in
               the application rather than in the formatting. It is also the number a
               grants officer quotes to a board. `sm` type fits seven figures. */
              value={withMark(
                amountRequested === null ? '--' : fmtMoney(amountRequested),
                'amountRequested',
              )}
              /* The annual figure, not just the length: "£35k / 3 years" left it open
               whether the ask was £35k a year. Falls back to the plain duration for a
               single-year grant, where there is nothing to mistake it for. */
              /* Once it is SHORTLISTED the subline changes job. Up to then the question is
               "how big is this ask", and the annual figure answers it. From then on the
               ask is drawing on a round budget that counts this year's cash, so the
               subline states what it draws and offers the correction — the figure in the
               meter has to be editable from the screen the meter is about, and this is
               the only place on it that already talks about this money. */
              sub={
                amountRequested === null ? (
                  canEdit ? (
                    // The one gap on this screen with a way to fill it on its own card:
                    // the assessment and shortlisting both wait on it.
                    <button
                      type="button"
                      className="underline"
                      style={{ color: C.brand }}
                      onClick={() =>
                        hasSubmission
                          ? setPickingField('amountRequested')
                          : setAdding(['amountRequested'])
                      }
                    >
                      {hasSubmission ? 'Choose from their answers' : 'Fill it in'}
                    </button>
                  ) : unreadAnswer(['amountRequested']) ? (
                    `could not read “${unreadAnswer(['amountRequested'])}”`
                  ) : (
                    'not found in the submission'
                  )
                ) : isShortlisted || !application.firstYearIsSuggested ? (
                  // What it draws this year. Corrected through the card's own pencil,
                  // beside the ask it is a share of, rather than a link of its own.
                  // Of the PROPOSAL where there is one, which this card's own figure is not,
                  // so the line says whose share it is.
                  // Once a proposal exists, this year's draw is ITS share and is stated on
                  // the proposal's card; this card goes back to describing the ask.
                  amountAmended !== null ? (
                    (fmtPerYear(amountRequested, rp.grantDurationYears) ??
                    fmtDuration(rp.grantDurationYears) ??
                    'As submitted')
                  ) : (
                    `${fmtMoney(firstYear ?? 0)} in ${fyLabel}`
                  )
                ) : (
                  <>
                    {fmtPerYear(amountRequested, rp.grantDurationYears) ??
                      fmtDuration(rp.grantDurationYears) ??
                      'Duration not set'}{' '}
                  </>
                )
              }
            />
          </EditableSlot>
          {/* The amount the foundation would AWARD, where an officer proposed a different
              one. Its own card with its own control rather than a second field on the
              amount card's pencil: that pencil corrects what the applicant asked for and
              locks once a trustee has voted, while a proposal is the foundation's figure
              and is expected to change AFTER the board has discussed it. */}
          {/* The pencil sits in the corner on hover or focus, as every editable card's
              does (`EditableSlot`), and opens the amount dialog rather than editing in
              place: the proposal comes with this year's share and a reason. */}
          <div className="group relative">
            <MiniKpi
              tint={KPI.proposed}
              icon={CoinsSwapIcon}
              label="Amount proposed"
              value={
                amountAmended === null || amountRequested === null ? (
                  '--'
                ) : (
                  <>
                    {fmtMoney(amountAmended)}
                    <span className="ml-1.5 text-label font-normal" style={{ color: C.sub }}>
                      {amendmentPercent(amountAmended, amountRequested)}
                    </span>
                  </>
                )
              }
              sub={
                amountAmended !== null && amountRequested !== null
                  ? // What it draws this year where that is a share of it, else how far it
                    // is from the ask in pounds (the percentage rides with the figure).
                    firstYear !== null && Math.abs(firstYear - amountAmended) >= 0.005
                    ? `${fmtMoney(firstYear)} in ${fyLabel}`
                    : `${fmtMoney(Math.abs(amountAmended - amountRequested))} ${amountAmended < amountRequested ? 'below' : 'above'} the ask`
                  : isAwarded
                    ? 'The award says what was given'
                    : 'As requested'
              }
            />
            {canPropose && (
              <button
                type="button"
                aria-label={
                  amountAmended === null
                    ? 'Propose a different amount'
                    : 'Change the proposed amount'
                }
                title={
                  amountAmended === null
                    ? 'Propose a different amount'
                    : 'Change the proposed amount'
                }
                onClick={() => {
                  setAmountMode('edit')
                  setAmountOpen(true)
                }}
                className="absolute right-2.5 top-2.5 z-20 inline-flex size-7 items-center justify-center rounded-chip border bg-white opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
                style={{ borderColor: C.line, color: C.body }}
              >
                <HugeiconsIcon icon={PencilEdit01Icon} size={14} strokeWidth={1.8} />
              </button>
            )}
          </div>
          {/* Beneficiaries and cost-per-beneficiary are one card, not two: the second
              is the first divided into the amount already in the card beside it, so as
              separate cards it read as a new fact when it is the same one restated.
              Programme lost its card entirely — it is the FIRST item in the header
              subline above, so nothing is lost, and the two slots it and the cost card
              freed are what the finances now occupy. */}
          <EditableSlot
            canEdit={canEdit}
            lockedReason={application.editLocked}
            label={`Edit the ${unitLabel.toLowerCase()} proposed`}
            applicationId={application.id}
            fields={['proposedImpactQuantity']}
            values={editValues}
            onSaved={onSaved}
            onChooseAnswer={chooseAnswer}
          >
            <MiniKpi
              tint={KPI.area}
              icon={UserGroupIcon}
              label="Beneficiaries"
              value={withMark(
                proposedImpact != null ? `~${proposedImpact.toLocaleString('en-GB')}` : '--',
                'proposedImpactQuantity',
              )}
              sub={
                <>
                  {proposedImpact != null
                    ? `${unitLabel.toLowerCase()}${costPerBeneficiary != null ? ` · ${fmtMoney(costPerBeneficiary)} each` : ''}`
                    : 'not stated'}{' '}
                </>
              }
            />
          </EditableSlot>
          {/* The applicant's own scale, next to what they are asking for — the pair a
              grants officer reads together to judge whether the ask is proportionate.
              `cc_grant_vs_income` already screens exactly this ratio; the difference is
              that a check reports a verdict and this reports the figure. */}
          <MiniKpi
            tint={KPI.income}
            icon={MoneyReceive01Icon}
            label="Income (last FY)"
            value={
              orgIncome != null ? <CompactMoney amount={orgIncome} label="Exact income" /> : '--'
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
          {/* Filled only from the application form, and that is the whole story: no
              Charity Commission endpoint publishes reserves (checked against the live
              API, see `OrganisationProfile.unrestrictedReserves`). It stood empty on
              every application until the form question became a canonical field, and it
              is still shown when empty so a foundation that doesn't ask can see what
              asking would buy them. Not editable: it is the applicant's own statement
              of their finances, so it reads as they gave it. */}
          <MiniKpi
            tint={KPI.reserves}
            icon={SafeBoxIcon}
            label="Unrestricted reserves"
            value={
              orgReserves != null
                ? withMark(
                    <CompactMoney amount={orgReserves} label="Exact reserves" />,
                    'unrestrictedReserves',
                  )
                : '--'
            }
            sub={
              <>
                {orgReserves != null ? (
                  reserveMonths != null && orgSpend != null ? (
                    // The two figures come from different places and different dates
                    // (the form now, the register's last filed year), and the divisor
                    // is TOTAL spending because the register does not split out
                    // unrestricted. A bare "~3 months" hides all of that.
                    <Tooltip
                      label="How months of spend is worked out"
                      trigger={`~${reserveMonths} months' spend`}
                    >
                      {fmtMoney(orgReserves)} unrestricted reserves
                      {reservesFromApplication ? ' (stated on the form)' : ''}, against{' '}
                      {fmtMoney(orgSpend)} total spending
                      {orgPeriodEnd ? ` in the year to ${orgPeriodEnd}` : ''} (Charity Commission
                      register). Total spending includes restricted funds, so this errs on the low
                      side.
                    </Tooltip>
                  ) : (
                    'as stated'
                  )
                ) : (
                  'not captured'
                )}{' '}
              </>
            }
          />
          {/* The deprivation panel that used to sit in the sidebar. Edited through the
              delivery area it is measured from: a vague area ("the North") is the most
              common reason there is no decile, and the person reading usually knows
              where the work actually happens. */}
          <EditableSlot
            canEdit={canEdit}
            lockedReason={application.editLocked}
            label="Edit the delivery area"
            applicationId={application.id}
            fields={['deliveryArea']}
            values={editValues}
            onSaved={onSaved}
            onChooseAnswer={chooseAnswer}
            hint="The area is looked up again when you save. A town, district or postcode works best."
          >
            <MiniKpi
              tint={KPI.community}
              icon={UserGroup02Icon}
              label="Community context"
              value={withMark(depResolved ? formatDecileRange(deprivation) : '--', 'deliveryArea')}
              sub={
                <>
                  {depResolved
                    ? [deprivation.vintage, region].filter(Boolean).join(' · ')
                    : application.deliveryArea
                      ? 'area not recognised'
                      : 'no delivery area'}{' '}
                </>
              }
            />
          </EditableSlot>
        </div>

        {/* Application budget */}
        {/* The applicant's lines, correctable in place like every other card. */}
        <EditableSlot
          canEdit={canEdit}
          lockedReason={application.editLocked}
          label="Edit the application budget"
          applicationId={application.id}
          onSaved={onSaved}
          editor={({ done, cancel }) => (
            <BudgetEditor
              applicationId={application.id}
              lines={budgetLines}
              onDone={done}
              onCancel={cancel}
            />
          )}
        >
          <Panel label="Application budget">
            <PanelTitle>
              <span className="inline-flex items-baseline gap-2">
                Application budget
                <EditedMark field="budgetBreakdown" edits={edits} />
              </span>
            </PanelTitle>
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
        </EditableSlot>

        {/* Due diligence checks */}
        <Panel>
          <PanelTitle
            right={
              <span className="hidden font-display text-label md:inline" style={{ color: C.sub }}>
                These checks feed the due diligence marks shown in the applications list.
              </span>
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
                    className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-chip p-3"
                    style={{ backgroundColor: C.wash }}
                  >
                    <span
                      className="shrink-0 font-display text-label font-medium"
                      style={{ color: failed ? C.danger : C.ink700 }}
                    >
                      {def?.label ?? r.key}
                    </span>
                    {/* The outcome side wraps; it does not shrink the label. A 360Giving
                        prior-funding line names three grants and runs to hundreds of
                        characters, and `shrink-0` here squeezed "Prior funding history"
                        into three lines while the detail still ran off the card. */}
                    <span
                      className="flex min-w-[12rem] flex-1 items-start justify-end gap-1.5 font-display text-label font-medium"
                      style={{ color: colour }}
                    >
                      {/* A warning leads with its icon — it is the thing to notice, and
                          the eye should meet it before the sentence. A tick is only the
                          confirmation of what the line already says, so it follows. */}
                      {failed && (
                        <HugeiconsIcon
                          icon={Alert02Icon}
                          size={16}
                          color={colour}
                          className="mt-px shrink-0"
                        />
                      )}
                      {/* A pass with no detail used to read "Clear", which says only that
                          the check ran. The definition says what it confirmed. */}
                      <span className="min-w-0 break-words text-right">
                        {r.detail ??
                          (ok ? (def?.passSummary ?? 'Clear') : failed ? 'Flagged' : 'Unverified')}
                      </span>
                      {!failed && (
                        <HugeiconsIcon
                          icon={Tick01Icon}
                          size={16}
                          color={colour}
                          className="mt-px shrink-0"
                        />
                      )}
                    </span>
                  </div>
                )
              })}
              {passedDdCount > 0 && (
                <div className="pt-1">
                  <Disclosure
                    open={showAllDd}
                    onToggle={() => setShowAllDd(!showAllDd)}
                    showLabel={`Show ${passedDdCount} passed ${passedDdCount === 1 ? 'check' : 'checks'}`}
                    hideLabel={`Hide ${passedDdCount} passed ${passedDdCount === 1 ? 'check' : 'checks'}`}
                  />
                </div>
              )}
            </div>
          ) : noRegistrationNumber ? (
            // "Not screened yet" reads as pending. When there is no registration
            // number it isn't pending — there is nothing to screen against, and no
            // amount of re-checking changes that. Say which, and offer the only thing
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

        {/* Not captured — the one place a silently-lost field becomes visible. */}
        {(gaps.any || laterGaps.length > 0) && (
          <Panel label="Not captured">
            <PanelTitle>Not captured</PanelTitle>
            <p className="mb-2.5 font-display text-body" style={{ color: C.sub }}>
              This submission didn't include the following, or included them in a form that
              couldn't be read, so the features that use them are unavailable on this
              application.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {[
                // The email and bank details hold up a LATER step (writing to the
                // applicant, paying a grant), not reading the application, so they sit
                // here with everything else that did not arrive rather than at the top.
                // The amount is the exception and is on its own card and the assessment.
                ...laterGaps.map((g) => ({
                  key: g.keys.join('-'),
                  keys: g.keys as string[],
                  label: g.label,
                  degrades: g.blocks,
                })),
                ...[...gaps.oneOf, ...gaps.expectedGroups].map((g) => ({
                  key: g.keys.join('-'),
                  keys: g.keys as string[],
                  label: g.label.replace(/^./, (ch) => ch.toUpperCase()),
                  degrades: g.degrades,
                })),
                ...gaps.expected.map((g) => ({
                  key: g.key,
                  keys: [g.key] as string[],
                  label: g.label,
                  degrades: g.degrades,
                })),
              ].map((g) => {
                // Offered only where every field of the gap is one a person can
                // fill: the budget is the applicant's own breakdown, not ours to write.
                // Naming an unnamed application is allowed even once trustees have voted
                // (`namingIsAllowed`), or it could never be awarded.
                const namingOnly = g.keys.length === 1 && g.keys[0] === 'organisationName'
                const fillable =
                  (canEdit || (namingOnly && application.canNameOrganisation)) &&
                  g.keys.every(isEditableField)
                const isBudgetGap = g.keys.includes('budgetBreakdown')
                const unread = unreadAnswer(g.keys)
                return (
                  <div
                    key={g.key}
                    className="flex items-start justify-between gap-3 rounded-chip px-3 py-2.5"
                    style={{ backgroundColor: C.wash }}
                  >
                    <div className="min-w-0">
                      <div className="font-display text-body" style={{ color: C.ink }}>
                        {g.label}
                      </div>
                      {unread && (
                        <div
                          className="mt-0.5 font-display text-label"
                          style={{ color: C.warning }}
                        >
                          They answered “{unread}”, which couldn't be read.
                        </div>
                      )}
                      <div className="mt-0.5 font-display text-label" style={{ color: C.sub }}>
                        {g.degrades}
                      </div>
                    </div>
                    {(fillable || (isBudgetGap && canEdit)) && (
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() =>
                          // The budget is lines, not fields: its Add opens the same line
                          // editor the Application budget card does, in a dialog like
                          // every other Add here.
                          isBudgetGap
                            ? setAddingBudget(true)
                            : setAdding(g.keys.filter(isEditableField))
                        }
                      >
                        Add
                      </Button>
                    )}
                  </div>
                )
              })}
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

        {/* Comments, and for admins the activity record on a tab beside them */}
        <Panel label="Comments">
          <CommentsSection
            applicationId={application.id}
            userId={user.id}
            userRole={user.role}
            // The loader's own object: new after every save on this screen, which is
            // exactly when the Activity tab has something new to show.
            activityKey={application}
          />
        </Panel>
      </div>

      {pickingField && (
        <AnswerPickerDialog
          open
          onClose={() => setPickingField(null)}
          applicationId={application.id}
          organisationName={application.organisationName}
          field={pickingField}
          onSaved={onSaved}
          onTypeInstead={() => setAdding([pickingField])}
        />
      )}
      <Dialog
        open={addingBudget}
        onClose={() => setAddingBudget(false)}
        title="Add the budget"
        description={application.organisationName}
        size="lg"
      >
        {addingBudget && (
          <BudgetEditor
            applicationId={application.id}
            lines={budgetLines}
            onCancel={() => setAddingBudget(false)}
            onDone={(outcome) => {
              setAddingBudget(false)
              onSaved(outcome)
            }}
          />
        )}
      </Dialog>
      <Dialog
        open={adding !== null}
        onClose={() => setAdding(null)}
        title="Fill in"
        description={application.organisationName}
        size="sm"
      >
        {adding && (
          <FieldEditor
            applicationId={application.id}
            fields={adding}
            values={editValues}
            onChooseAnswer={
              chooseAnswer
                ? (field) => {
                    setAdding(null)
                    chooseAnswer(field)
                  }
                : undefined
            }
            onCancel={() => setAdding(null)}
            onDone={(outcome) => {
              setAdding(null)
              onSaved(outcome)
            }}
          />
        )}
      </Dialog>

      {/* Only with an amount: there is nothing to propose against, or divide, without
          one, and Shortlist is unavailable until there is. */}
      {amountRequested !== null && (
        <AmountDialog
          open={amountOpen}
          onClose={() => setAmountOpen(false)}
          onConfirm={confirmAmount}
          mode={amountMode}
          organisationName={application.organisationName}
          amountRequested={amountRequested}
          amountAmended={amountAmended}
          firstYear={firstYear ?? 0}
          firstYearIsSuggested={application.firstYearIsSuggested}
          durationYears={rp.grantDurationYears}
          financialYearLabel={fyLabel}
          // Only where the answer draws on the round: when shortlisting, or once it is
          // shortlisted. Before that a proposal is a statement, and the ceiling is not
          // applied to it (nor, therefore, said).
          budgetRemaining={amountMode === 'shortlist' || isShortlisted ? budgetRemaining : null}
          enforced={application.enforceRoundBudget}
          votesCast={application.votesCast}
        />
      )}

      <ApplicationSubmissionDialog
        application={application}
        programmeName={application.roundProgramme.programme.name}
        open={submissionOpen}
        onClose={() => setSubmissionOpen(false)}
      />
    </div>
  )
}
