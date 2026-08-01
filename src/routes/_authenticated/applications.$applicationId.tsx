import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Coins01Icon,
  FolderLibraryIcon,
  UserGroupIcon,
  ChartAverageIcon,
  File01Icon,
  Mail01Icon,
  CheckmarkCircle02Icon,
  CancelCircleIcon,
  InformationCircleIcon,
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
import { Breadcrumb, MiniKpi } from '../../components/ui'
import { Donut } from '../../components/charts/Donut'
import {
  CRITERION_DEFINITIONS,
  CRITERION_ORDER,
  type CustodianScoreDetail,
} from '../../lib/custodianScore'
import { impactUnitLabel } from '../../lib/impactUnits'
import { CHECK_DEFINITIONS, type DueDiligenceCheckRecord } from '../../lib/dueDiligence'
import type { DeprivationContext } from '../../lib/deprivation/types'
import type { BudgetLine } from '../../lib/budget/types'
import { fmtCompact, fmtMoney } from '../../lib/format'

export const Route = createFileRoute('/_authenticated/applications/$applicationId')({
  loader: ({ params }) => getApplication({ data: { id: params.applicationId } }),
  component: ApplicationDetail,
})

// ─── Design tokens ───────────────────────────────────────────────────────────────
const C = {
  ink: '#141C24',
  sub: '#637083',
  faint: '#97A1AF',
  line: '#E4E7EC',
  wash: '#F2F4F7',
  brand: '#1F7A5C',
  brandBg: 'rgba(31, 122, 92, 0.1)',
  brandBorder: 'rgba(31, 122, 92, 0.2)',
  success: '#31A650',
  amber: '#9B6916',
  danger: '#FF4242',
}
const KPI = {
  amount: { bg: '#F5F4FF', accent: '#8B7FF0' },
  programme: { bg: '#EDF9F1', accent: '#31A650' },
  area: { bg: '#FEF7EB', accent: '#F89828' },
  headroom: { bg: '#FDEFF2', accent: '#F0537A' },
}
const BUDGET_COLORS = ['#8B7FF0', '#31A650', '#F5B851', '#F48FB1', '#4FBEE8', '#F0876B']

// RAG colour for a 1–10 criterion score: 0–3 red, 4–6 amber, 7+ green.
function ragColor(score: number) {
  if (score >= 7) return C.success
  if (score >= 4) return '#F5B851'
  return C.danger
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

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[16px] border bg-white p-4 ${className}`}
      style={{ borderColor: C.line }}
    >
      {children}
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

function HeaderChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 font-display text-[13px] font-medium"
      style={{ color: C.sub }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

// Score gauge — the same Recharts `Donut` the dashboard/insights use (so it animates
// its arc in on load for free), as a two-slice score/remainder ring with the money
// tooltip switched off.
function ScoreRing({
  score,
  size = 132,
  thickness = 15,
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
        <div className="flex flex-col items-center">
          <span
            className="font-display text-[32px] font-medium leading-none"
            style={{ color: C.ink }}
          >
            {score}
          </span>
          <span className="mt-0.5 font-display text-[12px]" style={{ color: C.faint }}>
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
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 font-display text-[13px]" style={{ color: C.sub }}>
        {label}
      </span>
      <ProgressBar
        className="flex-1"
        value={score / 10}
        color={color}
        track={withAlpha(color, 0.15)}
        height={8}
      />
      <span
        className="w-9 shrink-0 text-right font-display text-[13px] font-medium tabular-nums"
        style={{ color: C.ink }}
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
  const ddFlags = ddRecords.filter((r) => r.result === 'fail').length

  const deprivation = application.deprivationContext as DeprivationContext | null
  const depResolved = application.deprivationStatus === 'resolved' && deprivation != null
  const depShare =
    depResolved && deprivation.count > 0
      ? Math.round(
          (((deprivation.histogram[0] ?? 0) + (deprivation.histogram[1] ?? 0)) /
            deprivation.count) *
            100,
        )
      : null
  const region = application.deliveryRegion ?? application.deliveryArea ?? null

  const budgetLines = (application.budgetBreakdown as BudgetLine[] | null) ?? []
  const budgetTotal = budgetLines.reduce((s, l) => s + l.amount, 0) || amountRequested

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

  const statusMeta = isAwarded
    ? { label: 'Awarded', color: C.brand }
    : isShortlisted
      ? { label: 'Shortlisted', color: C.success }
      : isDeclined
        ? { label: 'Declined', color: C.danger }
        : { label: 'In review', color: C.amber }

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb
        items={[
          { label: 'Applications', to: '/applications', search: { roundId: undefined } },
          { label: application.organisationName },
        ]}
      />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: C.wash }}
          >
            <span className="font-display text-[14px] font-semibold" style={{ color: C.ink }}>
              {initials(application.organisationName)}
            </span>
          </div>
          <div>
            <h1 className="font-display text-[20px] font-medium" style={{ color: C.ink }}>
              {application.organisationName}
            </h1>
            <p className="font-display text-[13px]" style={{ color: C.sub }}>
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
        <div className="flex items-center gap-4">
          {application.charityNumber && (
            <HeaderChip color={C.success}>Registered charity</HeaderChip>
          )}
          <HeaderChip color={statusMeta.color}>{statusMeta.label}</HeaderChip>
          <HeaderChip color={ddFlags > 0 ? C.danger : C.success}>
            {ddFlags > 0
              ? `${ddFlags} due diligence flag${ddFlags !== 1 ? 's' : ''}`
              : 'No due diligence flags'}
          </HeaderChip>
          {/* A plain mailto rather than anything we send: this is the grants team
              picking up the phone, so it belongs in their own mail client with their
              own signature and a copy in their sent items. Hidden when the
              application carries no contact address. */}
          {application.applicantEmail && (
            <a
              href={`mailto:${encodeURIComponent(application.applicantEmail)}?subject=${encodeURIComponent(
                `Your application to ${clientName ?? 'us'}${
                  application.externalApplicationId ? ` (${application.externalApplicationId})` : ''
                }`,
              )}`}
              className="flex h-9 items-center gap-2 rounded-lg border bg-white px-3"
              style={{ borderColor: C.line }}
              title={application.applicantEmail}
            >
              <HugeiconsIcon icon={Mail01Icon} size={16} color={C.sub} />
              <span className="font-display text-[14px] font-medium" style={{ color: C.ink }}>
                Email applicant
              </span>
            </a>
          )}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg border bg-white px-3"
            style={{ borderColor: C.line }}
          >
            <HugeiconsIcon icon={File01Icon} size={16} color={C.sub} />
            <span className="font-display text-[14px] font-medium" style={{ color: C.ink }}>
              View submission
            </span>
          </button>
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
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <div className="flex flex-col gap-4">
          {/* AI Assessment */}
          <Panel>
            <PanelTitle>AI Assessment</PanelTitle>

            {scored ? (
              <div className="flex flex-col gap-6 md:flex-row md:items-center">
                <div className="flex items-center gap-4 md:w-[46%] md:shrink-0">
                  <ScoreRing score={score} />
                  <div>
                    <p
                      className="font-display text-[14px] leading-relaxed"
                      style={{ color: C.sub }}
                    >
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
                <div className="flex flex-1 flex-col gap-2.5">
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
              <ul
                className="mt-4 flex flex-col gap-1.5 border-t pt-4"
                style={{ borderColor: C.line }}
              >
                {scoreDetail.flags.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 font-display text-[13px]"
                    style={{ color: C.amber }}
                  >
                    <span className="mt-0.5">⚠</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
              sub={
                costPerBeneficiary != null ? `per ${unitSingular.toLowerCase()}` : 'no target set'
              }
            />
          </div>

          {/* Project budget */}
          <Panel>
            <PanelTitle>Project budget</PanelTitle>
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
            ) : (
              <p className="font-display text-[14px]" style={{ color: C.sub }}>
                No budget breakdown was provided with this application.
              </p>
            )}
          </Panel>

          {/* Due diligence checks */}
          <Panel>
            <PanelTitle
              right={
                <button
                  type="button"
                  onClick={handleRerunDD}
                  disabled={rerunningDD}
                  className="flex h-8 items-center rounded-lg border bg-white px-3 font-display text-[13px] font-medium disabled:opacity-60"
                  style={{ borderColor: C.line, color: C.ink }}
                >
                  {rerunningDD ? 'Re-running…' : 'Re-run'}
                </button>
              }
            >
              Due diligence checks
            </PanelTitle>
            {ddRecords.length > 0 ? (
              <div className="flex flex-col gap-2">
                {ddRecords.map((r, i) => {
                  const def = CHECK_DEFINITIONS[r.key]
                  const ok = r.result === 'pass'
                  const failed = r.result === 'fail'
                  const color = ok ? C.success : failed ? C.danger : C.faint
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
                      style={{ backgroundColor: C.wash }}
                    >
                      <span className="font-display text-[14px]" style={{ color: C.ink }}>
                        {def?.label ?? r.key}
                      </span>
                      <span
                        className="flex items-center gap-1.5 font-display text-[13px] font-medium"
                        style={{ color }}
                      >
                        <HugeiconsIcon
                          icon={failed ? CancelCircleIcon : CheckmarkCircle02Icon}
                          size={16}
                          color={color}
                        />
                        {r.detail ?? (ok ? 'Clear' : failed ? 'Flagged' : 'Unverified')}
                      </span>
                    </div>
                  )
                })}
              </div>
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
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          {/* Decision */}
          <Panel>
            <div className="mb-3 flex items-center gap-1.5">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: statusMeta.color }}
              />
              <span className="font-display text-[13px] font-medium" style={{ color: C.ink }}>
                {statusMeta.label}
                {roundName ? ` for ${roundName}` : ''}
              </span>
            </div>

            {isAwarded ? (
              <div
                className="flex items-center justify-center gap-2 rounded-lg py-2.5 font-display text-[14px] font-medium"
                style={{ backgroundColor: C.brandBg, color: C.brand }}
              >
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} color={C.brand} /> Awarded
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleShortlist}
                  disabled={shortlisting || isBudgetFull}
                  title={
                    isBudgetFull
                      ? 'Budget committed — no funds remaining in this programme'
                      : undefined
                  }
                  className="flex h-10 items-center justify-center rounded-lg font-display text-[14px] font-medium disabled:opacity-50"
                  style={
                    isShortlisted
                      ? { border: `1px solid ${C.line}`, color: C.ink, background: '#fff' }
                      : { background: C.brand, color: '#fff' }
                  }
                >
                  {shortlisting
                    ? '…'
                    : isShortlisted
                      ? 'Remove from shortlist'
                      : isBudgetFull
                        ? 'Budget full'
                        : 'Add to shortlist'}
                </button>
                <button
                  type="button"
                  onClick={handleDecline}
                  disabled={declining}
                  className="flex h-10 items-center justify-center rounded-lg font-display text-[14px] font-medium disabled:opacity-50"
                  style={{
                    border: `1px solid ${isDeclined ? withAlpha(C.danger, 0.3) : C.line}`,
                    color: C.danger,
                    background: isDeclined ? withAlpha(C.danger, 0.06) : '#fff',
                  }}
                >
                  {declining ? '…' : isDeclined ? 'Reinstate to review' : 'Move to declined'}
                </button>
              </div>
            )}

            {depShare != null && (
              <div
                className="mt-3 flex items-start gap-2 rounded-lg p-3"
                style={{ backgroundColor: C.wash }}
              >
                <HugeiconsIcon
                  icon={InformationCircleIcon}
                  size={16}
                  color={C.sub}
                  className="mt-0.5 shrink-0"
                />
                <p className="font-display text-[13px] leading-relaxed" style={{ color: C.sub }}>
                  <span style={{ color: C.ink, fontWeight: 500 }}>{depShare}%</span> reaches IMD
                  decile {deprivation!.min}–{deprivation!.max}
                  {region ? `, concentrated in ${region}` : ''}.
                </p>
              </div>
            )}
          </Panel>

          {/* Notes (comments) */}
          <Panel>
            <PanelTitle>Notes</PanelTitle>
            <CommentsSection applicationId={application.id} userId={user.id} userRole={user.role} />
          </Panel>

          {/* Community context */}
          {(scored || depResolved) && (
            <Panel>
              <PanelTitle>Community context</PanelTitle>
              {scored && scoreDetail.criteria.community_need && (
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="font-display text-[20px] font-medium" style={{ color: C.ink }}>
                    {scoreDetail.criteria.community_need.score}/10
                  </span>
                  <span className="font-display text-[13px]" style={{ color: C.sub }}>
                    community need
                  </span>
                </div>
              )}
              {depResolved && (
                <p className="font-display text-[14px]" style={{ color: C.ink }}>
                  Decile {deprivation.min}–{deprivation.max}
                  <span style={{ color: C.sub }}>
                    {' '}
                    · {deprivation.vintage}
                    {region ? ` · ${region}` : ''}
                  </span>
                </p>
              )}
            </Panel>
          )}
        </div>
      </div>

      <ApplicationDrawer
        application={application}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  )
}
