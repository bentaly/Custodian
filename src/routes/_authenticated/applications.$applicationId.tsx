import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { orNotFound } from '../../lib/loader'
import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Coins01Icon,
  FolderLibraryIcon,
  UserGroupIcon,
  UserGroup02Icon,
  ChartAverageIcon,
  File01Icon,
  Mail01Icon,
  CheckmarkCircle02Icon,
  ArrowLeft01Icon,
  Alert02Icon,
  Tick01Icon,
} from '@hugeicons/core-free-icons'
import {
  getApplication,
  rerunDueDiligence,
  updateApplicationStatus,
} from '../../server/fns/applications'
import { ApplicationDrawer } from '../../components/ApplicationDrawer'
import { CommentsSection } from '../../components/CommentsSection'
import { VotingSection } from '../../components/VotingSection'
import { ProgressBar } from '../../components/ProgressBar'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import { Boundary, Breadcrumb, Button, MiniKpi } from '../../components/ui'
import { Donut } from '../../components/charts/Donut'
import {
  CRITERION_DEFINITIONS,
  CRITERION_ORDER,
  type CustodianScoreDetail,
} from '../../lib/custodianScore'
import { applicationStatusLabel } from '../../lib/validators/application'
import { impactUnitLabel } from '../../lib/impactUnits'
import { CHECK_DEFINITIONS, type DueDiligenceCheckRecord } from '../../lib/dueDiligence'
import { fieldGaps } from '../../lib/fieldMapping/gaps'
import type { DeprivationContext } from '../../lib/deprivation/types'
import type { BudgetLine } from '../../lib/budget/types'
import { budgetDocumentName } from '../../lib/budget/link'
import { fmtCompact, fmtMoney } from '../../lib/format'
import { C as TOKENS } from '../../components/ui/tokens'

export const Route = createFileRoute('/_authenticated/applications/$applicationId')({
  loader: ({ params }) => orNotFound(getApplication({ data: { id: params.applicationId } })),
  component: ApplicationDetail,
})

// ─── Design tokens ───────────────────────────────────────────────────────────────
const C = {
  ...TOKENS,
  ink700: '#344051',
}
const KPI = {
  amount: { bg: '#F5F4FF', accent: '#8B7FF0' },
  programme: { bg: '#EDF9F1', accent: '#31A650' },
  area: { bg: '#FEF7EB', accent: '#F89828' },
  headroom: { bg: '#FDEFF2', accent: '#F0537A' },
  community: { bg: '#EEF4FF', accent: '#4FBEE8' },
}
const BUDGET_COLORS = ['#8B7FF0', '#31A650', '#F5B851', '#F48FB1', '#4FBEE8', '#F0876B']

// RAG colour for a 1–10 criterion score: 0–3 red, 4–6 amber, 7+ green.
// The criterion palette is its own (Figma 435:38445) — a cooler teal and a warmer
// amber than the status colours, so a bank of six bars doesn't read as six statuses.
function ragColor(score: number) {
  if (score >= 7) return '#1AB393'
  if (score >= 4) return '#FABF24'
  return '#DC2626'
}

// ─── Formatting ──────────────────────────────────────────────────────────────────
function initials(name: string) {
  const p = name.trim().split(/\s+/).filter(Boolean)
  if (p.length === 0) return '—'
  if (p.length === 1) return p[0]!.slice(0, 2).toUpperCase()
  return (p[0]![0]! + p[p.length - 1]![0]!).toUpperCase()
}
function scoreColor(score: number) {
  if (score >= 75) return C.brand
  if (score >= 50) return C.amber
  return C.danger
}
function durationLabel(years: number | null | undefined) {
  if (!years) return null
  return years === 1 ? '12 months' : `${years} years`
}

// ─── Primitives ──────────────────────────────────────────────────────────────────

/**
 * A section of the detail page, isolated behind its own error boundary.
 *
 * This page is where the app's least predictable data lands: `custodianScoreDetail`,
 * `dueDiligenceChecks` and `deprivationContext` are jsonb columns holding AI- and
 * third-party-produced shapes, destructured directly by the panels below, and the
 * budget meter renders whatever numbers it is handed. Before this, one unexpected null
 * in any of them threw during render and took the whole page with it — comments,
 * voting, the award action, everything. Now the rest of the page survives.
 */
function Panel({
  children,
  className = '',
  label,
}: {
  children: React.ReactNode
  className?: string
  label?: string
}) {
  return (
    <div
      className={`rounded-[16px] border bg-white p-4 ${className}`}
      style={{ borderColor: C.line }}
    >
      <Boundary label={label}>{children}</Boundary>
    </div>
  )
}

/**
 * The way out of the one dead end due diligence has: an application with no
 * registration number can never be screened, and pressing Re-run reads the same empty
 * columns and returns "not screened" forever.
 *
 * Two routes lead here, and neither can be fixed upstream. A grant imported from a
 * foundation's back catalogue arrives already awarded and deliberately unscreened, and
 * the import treats a missing number as a degradation rather than a blocker — refusing
 * history is not an option. And an application awarded before the one-of gate existed
 * has its ingest mapping frozen, because the award letter was written from those
 * figures. A registration number is not one of those figures, and a grantee still
 * receiving instalments is exactly the one worth screening late.
 */
function ScreenWithNumber({
  applicationId,
  canEdit,
}: {
  applicationId: string
  canEdit: boolean
}) {
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
      <p className="font-display text-[14px]" style={{ color: C.sub }}>
        Not screened — this application has no charity number or company number, so there is no
        register to check it against. Re-running will not change that.
      </p>
      {canEdit && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-2 font-display text-[13px] font-medium underline underline-offset-2"
          style={{ color: C.brand }}
        >
          Add a registration number and screen now
        </button>
      )}
      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="font-display text-[12px]" style={{ color: C.sub }}>
            Give whichever the organisation holds — either alone is enough. The checks run
            immediately, and the number is recorded against this application.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={charityNumber}
              onChange={(e) => setCharityNumber(e.target.value)}
              placeholder="Charity number (e.g. 219279 or SC003558)"
              className="min-w-56 flex-1 rounded-lg border px-3 py-2 font-display text-[13px]"
              style={{ borderColor: C.line }}
            />
            <input
              value={companyNumber}
              onChange={(e) => setCompanyNumber(e.target.value)}
              placeholder="Company number (e.g. 03782379)"
              className="min-w-56 flex-1 rounded-lg border px-3 py-2 font-display text-[13px]"
              style={{ borderColor: C.line }}
            />
          </div>
          {error && (
            <p className="font-display text-[12px]" style={{ color: C.danger }}>
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

function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

/** The grey status pill in the header (Figma 435:42454) — a coloured dot and a label. */
function StatusPill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-display text-[12px] font-medium"
      style={{ backgroundColor: C.wash, color: C.sub }}
    >
      <span className="size-[3px] rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
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
  title,
  href,
  children,
}: {
  tone: keyof typeof HEADER_TONE
  icon?: typeof File01Icon
  onClick?: () => void
  disabled?: boolean
  title?: string
  href?: string
  children: React.ReactNode
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
        title={title}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[12px] border px-4 font-display text-[14px] font-medium"
        style={style}
      >
        {icon && <HugeiconsIcon icon={icon} size={18} color="currentColor" />}
        {children}
      </a>
    )
  }
  return (
    <Button variant={variant} icon={icon} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </Button>
  )
}

// Score gauge — the same Recharts `Donut` the dashboard/insights use (so it animates
// its arc in on load for free), as a two-slice score/remainder ring with the money
// tooltip switched off.
function ScoreRing({
  score,
  size = 120,
  thickness = 12,
}: {
  score: number
  size?: number
  thickness?: number
}) {
  const pct = Math.max(0, Math.min(100, score))
  const color = scoreColor(score)
  return (
    <Donut
      size={size}
      thickness={thickness}
      tooltip={false}
      data={[
        { name: 'Score', value: pct, color },
        { name: 'Remaining', value: 100 - pct, color: withAlpha(color, 0.15) },
      ]}
      center={
        <div className="flex items-baseline gap-1">
          <span
            className="font-display text-[24px] font-medium leading-none"
            style={{ color: C.ink }}
          >
            {score}
          </span>
          <span className="font-display text-[12px]" style={{ color: C.faint }}>
            /100
          </span>
        </div>
      }
    />
  )
}

function CriterionBar({ label, score }: { label: string; score: number }) {
  const color = ragColor(score)
  return (
    <div className="flex items-center gap-4">
      <span
        className="w-[104px] shrink-0 font-display text-[12px] font-medium"
        style={{ color: C.ink }}
      >
        {label}
      </span>
      <ProgressBar
        className="flex-1"
        value={score / 10}
        color={color}
        track={withAlpha(color, 0.2)}
        height={4}
      />
      <span
        className="w-8 shrink-0 text-right font-display text-[12px] font-medium tabular-nums"
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
  const [shortlisting, setShortlisting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isShortlisted = application.status === 'shortlisted'
  const isDeclined = application.status === 'declined'
  const isAwarded = application.status === 'awarded'
  const awardId = application.award?.id ?? null

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

  const ddRecords = (application.dueDiligenceChecks as DueDiligenceCheckRecord[] | null) ?? []

  const deprivation = application.deprivationContext as DeprivationContext | null
  const depResolved = application.deprivationStatus === 'resolved' && deprivation != null
  const region = application.deliveryRegion ?? application.deliveryArea ?? null

  const budgetLines = (application.budgetBreakdown as BudgetLine[] | null) ?? []
  const budgetTotal = budgetLines.reduce((s, l) => s + l.amount, 0) || amountRequested

  // A budget sent as a file rather than as fields. Opaque to us — nothing reads it, so
  // it feeds neither the breakdown above nor the Custodian score — but it answers the
  // same question for a reader, which is why it satisfies the budget pair in `gaps`.
  const budgetLink = application.budgetBreakdownLink ?? null
  const budgetLinkName = budgetLink ? budgetDocumentName(budgetLink) : null

  // Beneficiaries + cost-per-beneficiary come from what the applicant PROPOSES on
  // this application (a forward-looking count in the programme's impact unit).
  const unitLabel = impactUnitLabel(programme.impactUnit, programme.impactUnitLabel)
  const unitSingular = unitLabel.replace(/s$/i, '') || unitLabel
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
  const gaps = fieldGaps({
    charityNumber: application.charityNumber,
    companyNumber: application.companyNumber,
    deliveryArea: application.deliveryArea,
    budgetBreakdown: budgetLines,
    budgetBreakdownLink: application.budgetBreakdownLink,
    proposedImpactQuantity: application.proposedImpactQuantity,
  })
  const noRegistrationNumber = gaps.oneOf.length > 0

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
  const statusColor = isAwarded
    ? C.brand
    : isShortlisted
      ? C.success
      : isDeclined
        ? C.danger
        : C.amber
  const statusMeta = { label: applicationStatusLabel(application.status), color: statusColor }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb
        items={[
          { label: 'Applications', to: '/applications', search: { roundId: undefined } },
          { label: application.organisationName },
        ]}
      />

      {/* Header — Figma 435:38405. The decision buttons live here now rather than in a
          sidebar, so the whole page is one full-width column. */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/applications"
          search={{ roundId: undefined }}
          aria-label="Back to applications"
          className="flex shrink-0 items-center justify-center rounded-lg border bg-white p-2"
          style={{ borderColor: C.line }}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} color={C.ink} />
        </Link>

        <div className="flex min-w-[240px] flex-1 items-center gap-2">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: C.wash }}
          >
            <span className="font-display text-[14px] font-semibold" style={{ color: C.ink }}>
              {initials(application.organisationName)}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[14px] font-medium" style={{ color: C.ink }}>
              {application.organisationName}
            </h1>
            <p className="truncate font-display text-[12px]" style={{ color: C.sub }}>
              {[
                programme.name,
                application.charityNumber ? `Charity no. ${application.charityNumber}` : null,
                region,
                roundName ? `${roundName} round` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>

        <StatusPill color={statusMeta.color}>{statusMeta.label}</StatusPill>

        <div className="flex flex-wrap items-center gap-2">
          {/* A plain mailto rather than anything we send: this is the grants team
              picking up the phone, so it belongs in their own mail client with their
              own signature and a copy in their sent items. Hidden when the
              application carries no contact address. */}
          {application.applicantEmail && (
            <HeaderButton
              tone="plain"
              icon={Mail01Icon}
              title={application.applicantEmail}
              href={`mailto:${encodeURIComponent(application.applicantEmail)}?subject=${encodeURIComponent(
                `Your application to ${clientName ?? 'us'}${
                  application.externalApplicationId ? ` (${application.externalApplicationId})` : ''
                }`,
              )}`}
            >
              Email applicant
            </HeaderButton>
          )}
          <HeaderButton tone="brand" icon={File01Icon} onClick={() => setDrawerOpen(true)}>
            View submission
          </HeaderButton>
          {isAwarded ? (
            // Awarded is terminal *here*: `updateApplicationStatus` refuses to move an
            // application with a live award row, so a status button or dropdown in this
            // slot would be a control that can only ever error. The real onward action
            // is the grant itself — that is where the schedule, the letter and (when it
            // is built) cancelling live.
            awardId ? (
              <Link
                to="/awards/$awardId"
                params={{ awardId }}
                className="flex h-10 shrink-0 items-center gap-2 rounded-[12px] border px-3 font-display text-[14px] font-medium"
                style={{ backgroundColor: C.brand, borderColor: C.brand, color: '#fff' }}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} color="#fff" />
                View award
              </Link>
            ) : (
              // Awarded with no award row — not yet backfilled. State, not action.
              <span
                className="flex h-10 shrink-0 items-center gap-2 rounded-[12px] border px-3 font-display text-[14px] font-medium"
                style={{ backgroundColor: C.brandBg, borderColor: C.brandBorder, color: C.brand }}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} color={C.brand} />
                Awarded
              </span>
            )
          ) : (
            <>
              <HeaderButton tone="danger" onClick={handleDecline} disabled={declining}>
                {declining ? '…' : isDeclined ? 'Reinstate to review' : 'Decline'}
              </HeaderButton>
              <HeaderButton
                tone={isShortlisted ? 'plain' : 'primary'}
                onClick={handleShortlist}
                disabled={shortlisting || isBudgetFull}
                title={
                  isBudgetFull
                    ? 'Budget committed — no funds remaining in this programme'
                    : undefined
                }
              >
                {shortlisting
                  ? '…'
                  : isShortlisted
                    ? 'Remove from shortlist'
                    : isBudgetFull
                      ? 'Budget full'
                      : 'Shortlist'}
              </HeaderButton>
            </>
          )}
        </div>
      </div>

      {error && (
        <div
          className="rounded-lg border px-3 py-2 font-display text-[13px]"
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
        {/* AI Assessment */}
        <Panel label="AI assessment">
          <PanelTitle>AI Assessment</PanelTitle>

          {scored ? (
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
              <div className="flex flex-1 items-center gap-4">
                <ScoreRing score={score} />
                <div>
                  <p className="font-display text-[14px] leading-relaxed" style={{ color: C.sub }}>
                    {scoreDetail.summary}
                  </p>
                  <span
                    className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-display text-[12px] font-medium"
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
            <p className="font-display text-[14px]" style={{ color: C.sub }}>
              {scoreStatus === 'error'
                ? 'Scoring failed — try re-scoring.'
                : 'This application has not been scored yet.'}
            </p>
          )}

          {scored && scoreDetail.flags.length > 0 && (
            <ul className="mt-4 flex flex-col gap-1.5">
              {scoreDetail.flags.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg p-1.5 font-display text-[12px] font-medium"
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
          )}
        </Panel>

        {/* KPI cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MiniKpi
            tint={KPI.amount}
            icon={Coins01Icon}
            label="Amount requested"
            value={fmtCompact(amountRequested)}
            sub={durationLabel(rp.grantDurationYears) ?? 'Duration not set'}
          />
          <MiniKpi
            tint={KPI.programme}
            icon={FolderLibraryIcon}
            label="Programme"
            value={programme.name}
            sub={roundName ?? '—'}
          />
          <MiniKpi
            tint={KPI.area}
            icon={UserGroupIcon}
            label="Beneficiaries"
            value={proposedImpact != null ? `~${proposedImpact.toLocaleString('en-GB')}` : '—'}
            sub={proposedImpact != null ? `${unitLabel.toLowerCase()} · proposed` : 'not stated'}
          />
          <MiniKpi
            tint={KPI.headroom}
            icon={ChartAverageIcon}
            label="Cost per beneficiary"
            value={costPerBeneficiary != null ? fmtMoney(costPerBeneficiary) : '—'}
            sub={costPerBeneficiary != null ? `per ${unitSingular.toLowerCase()}` : 'no target set'}
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
                  className="font-display text-[24px] font-medium leading-none"
                  style={{ color: C.ink }}
                >
                  {fmtMoney(budgetTotal)}
                </span>
                <span className="font-display text-[13px]" style={{ color: C.sub }}>
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
                  color: BUDGET_COLORS[i % BUDGET_COLORS.length]!,
                }))}
              />
              <div className="flex flex-col gap-2.5">
                {budgetLines.map((l, i) => {
                  const pct = budgetTotal > 0 ? Math.round((l.amount / budgetTotal) * 100) : 0
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: BUDGET_COLORS[i % BUDGET_COLORS.length] }}
                      />
                      <span
                        className="flex-1 truncate font-display text-[14px]"
                        style={{ color: C.ink }}
                        title={l.item}
                      >
                        {l.item}
                      </span>
                      <span
                        className="w-24 text-right font-display text-[14px] font-medium tabular-nums"
                        style={{ color: C.ink }}
                      >
                        {fmtMoney(l.amount)}
                      </span>
                      <span
                        className="w-10 text-right font-display text-[13px] tabular-nums"
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
            <p className="font-display text-[14px]" style={{ color: C.sub }}>
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
                className="font-display text-[14px] underline underline-offset-2"
                style={{ color: C.ink }}
              >
                {budgetLinkName}
              </a>
              <p className="mt-1 font-display text-[13px]" style={{ color: C.sub }}>
                The applicant supplied their budget as a document. It opens in a new tab and
                isn't read by Custodian, so it doesn't feed the breakdown or the score.
              </p>
            </div>
          )}
        </Panel>

        {/* Due diligence checks */}
        <Panel>
          <PanelTitle
            right={
              <div className="flex items-center gap-3">
                <span
                  className="hidden font-display text-[12px] md:inline"
                  style={{ color: C.sub }}
                >
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
              {ddRecords.map((r, i) => {
                const def = CHECK_DEFINITIONS[r.key]
                const ok = r.result === 'pass'
                const failed = r.result === 'fail'
                const color = ok ? C.brand : failed ? C.danger : C.faint
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg p-3"
                    style={{ backgroundColor: C.wash }}
                  >
                    <span
                      className="font-display text-[12px] font-medium"
                      style={{ color: failed ? C.danger : C.ink700 }}
                    >
                      {def?.label ?? r.key}
                    </span>
                    <span
                      className="flex shrink-0 items-center gap-1 font-display text-[12px] font-medium"
                      style={{ color }}
                    >
                      <HugeiconsIcon
                        icon={failed ? Alert02Icon : Tick01Icon}
                        size={16}
                        color={color}
                      />
                      {r.detail ?? (ok ? 'Clear' : failed ? 'Flagged' : 'Unverified')}
                    </span>
                  </div>
                )
              })}
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
            <p className="font-display text-[14px]" style={{ color: C.sub }}>
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
            <p className="mb-2.5 font-display text-[13px]" style={{ color: C.sub }}>
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
                  className="rounded-lg px-3 py-2.5"
                  style={{ backgroundColor: C.wash }}
                >
                  <div className="font-display text-[14px]" style={{ color: C.ink }}>
                    {g.label}
                  </div>
                  <div className="mt-0.5 font-display text-[12.5px]" style={{ color: C.sub }}>
                    {g.degrades}
                  </div>
                </div>
              ))}
            </div>
            <Button variant="text" size="xs" onClick={() => setDrawerOpen(true)} className="mt-2.5">
              Check the submission →
            </Button>
          </Panel>
        )}

        {/* Comments */}
        <Panel label="Comments">
          <CommentsSection applicationId={application.id} userId={user.id} userRole={user.role} />
        </Panel>
      </div>

      <ApplicationDrawer
        application={application}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
