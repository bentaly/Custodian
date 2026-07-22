import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Files01Icon,
  File01Icon,
  Coins01Icon,
  CheckListIcon,
  Award01Icon,
  Message01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons'
import { Card as UiCard } from '../../components/ui'
import { BarMeter, type BarSegment, withAlpha } from '../../components/BarMeter'
import { ProgressBar } from '../../components/ProgressBar'
import { Donut, type DonutSlice } from '../../components/charts/Donut'
import { GivingArea } from '../../components/charts/GivingArea'
import { getDashboard } from '../../server/fns/dashboard'

type DashboardData = Awaited<ReturnType<typeof getDashboard>>

export const Route = createFileRoute('/_authenticated/dashboard')({
  beforeLoad: ({ context }) => {
    // A platform superadmin with no tenant has no dashboard data — send them to
    // Profile (which hosts the impersonation console). A superadmin who also belongs
    // to a client keeps a normal dashboard.
    if (context.user.role === 'superadmin' && !context.user.clientId) {
      throw redirect({ to: '/profile' })
    }
  },
  loader: async () => getDashboard(),
  component: Dashboard,
})

// ─── Design tokens ─────────────────────────────────────────────────────────────
// Centralised so the whole screen re-themes from one place when the full Figma token
// set lands. The named greys/status colours are the current Figma variables; the KPI
// tints and chart hues are picked to match the dashboard comp until they're tokenised.
const C = {
  ink: '#141C24', // Gray/900
  body: '#374050',
  sub: '#637083', // Gray/500
  faint: '#98A2B3',
  line: '#E4E7EC', // Gray/200
  wash: '#F2F4F7', // Gray/100
  success: '#31A650',
  danger: '#FF4242',
  warning: '#F89828',
  info: '#3B82C4',
}

// KPI card tints: { bg, border, accent } per metric.
const KPI = {
  apps: { bg: '#F5F4FF', border: '#E7E4FB', accent: '#8B7FF0' },
  review: { bg: '#EDF9F1', border: '#D5EFDE', accent: '#31A650' },
  finance: { bg: '#FEF7EB', border: '#F7E7C6', accent: '#F89828' },
  reports: { bg: '#FDEFF2', border: '#F8D9E1', accent: '#F0537A' },
}

// Round donut / programme-bar palette.
const PROG_COLORS = ['#4FBEE8', '#F48FB1', '#F5B851', '#8B7FF0', '#5BD1B0', '#F0876B']
const ALLOCATE_LEFT = '#E9ECF1'

// ─── Formatting helpers ─────────────────────────────────────────────────────────

function fmtCompact(n: number) {
  const neg = n < 0
  const a = Math.abs(n)
  let s: string
  if (a >= 1_000_000) s = `£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}m`
  else if (a >= 1_000) s = `£${Math.round(a / 1_000)}k`
  else s = `£${Math.round(a).toLocaleString('en-GB')}`
  return neg ? `-${s}` : s
}
function relativeTime(date: Date | string) {
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d`
  const wks = Math.round(days / 7)
  return `${wks}w`
}
function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
}
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good Morning'
  if (h < 18) return 'Good Afternoon'
  return 'Good Evening'
}
function firstName(name: string) {
  return name.split(' ')[0] || name
}
const plural = (n: number) => (n !== 1 ? 's' : '')

// ─── Small primitives ───────────────────────────────────────────────────────────

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border bg-white p-4 ${className}`}
      style={{ borderColor: C.line }}
    >
      {children}
    </div>
  )
}

// Panel heading — Figma: Inter Display, 16px, medium, Gray/900.
function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

type Chip = { label: string; count: number; color: string }

function Chips({ chips }: { chips: Chip[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" style={{ color: C.sub }}>
      {chips.map((c) => (
        <span key={c.label} className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.color }} />
          {c.count} {c.label}
        </span>
      ))}
    </div>
  )
}

// ─── KPI card ───────────────────────────────────────────────────────────────────

function KpiCard({
  tint,
  value,
  sub,
  subColor,
  icon,
  label,
  to,
  search,
  meter,
  children,
}: {
  tint: { bg: string; border: string; accent: string }
  value: string
  sub: string
  subColor?: string
  icon: typeof Files01Icon
  label: string
  to: string
  search?: Record<string, unknown>
  meter: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      search={search}
      className="flex flex-col rounded-[20px] border bg-white p-1 transition-shadow hover:shadow-sm"
      style={{ borderColor: C.line }}
    >
      {/* Tinted inner panel (Figma 112:134) — inset 4px, holds the number/meter/chips. */}
      <div className="relative overflow-hidden rounded-2xl p-4" style={{ backgroundColor: tint.bg }}>
        {/* Figma "Mask group" (112:802): a radial accent gradient shown *through* a dot
            grid — the gradient is the fill, the dots are the mask. Top-right, offset up. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 z-0 aspect-square w-1/2 -translate-y-[17%]"
          style={{
            backgroundImage: `radial-gradient(50% 50% at 50% 50%, ${withAlpha(tint.accent, 0.5)} 0%, ${withAlpha(tint.accent, 0)} 100%)`,
            WebkitMaskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            maskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            WebkitMaskSize: '7px 7px',
            maskSize: '7px 7px',
          }}
        />
        <div className="relative z-10">
          <div className="text-[30px] font-semibold leading-none" style={{ color: C.ink }}>
            {value}
          </div>
          <div className="mt-1.5 text-xs font-medium" style={{ color: subColor ?? C.sub }}>
            {sub}
          </div>
          <div className="mt-3">{meter}</div>
          {children}
        </div>
      </div>
      {/* Footer on the white card. */}
      <div className="flex items-center gap-2 px-4 py-3">
        <HugeiconsIcon icon={icon} className="h-4 w-4" strokeWidth={1.6} style={{ color: C.sub }} />
        <span className="text-[13px] font-medium" style={{ color: C.ink }}>
          {label}
        </span>
      </div>
    </Link>
  )
}

// ─── "On your desk" rows ──────────────────────────────────────────────────────────

const TAG_COLOR: Record<string, string> = {
  Applications: C.success,
  Finance: C.warning,
  Review: C.info,
  Giving: '#E0568A',
  Reports: '#F0537A',
}

function DeskRow({
  icon,
  iconTint,
  lead,
  rest,
  tag,
  to,
  search,
}: {
  icon: typeof Files01Icon
  iconTint: { bg: string; accent: string }
  lead: string
  rest: string
  tag: string
  to: string
  search?: Record<string, unknown>
}) {
  return (
    <Link
      to={to}
      search={search}
      className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[#FAFAFB]"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: iconTint.bg }}
      >
        <HugeiconsIcon icon={icon} className="h-[18px] w-[18px]" strokeWidth={1.7} style={{ color: iconTint.accent }} />
      </span>
      <span className="min-w-0 flex-1 text-[13.5px]" style={{ color: C.body }}>
        <span className="font-semibold" style={{ color: C.ink }}>
          {lead}
        </span>{' '}
        {rest}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium" style={{ color: TAG_COLOR[tag] }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: TAG_COLOR[tag] }} />
        {tag}
      </span>
    </Link>
  )
}

// ─── "Lately" (audit log) rows ────────────────────────────────────────────────────

const LATELY_META: Record<string, { icon: typeof Award01Icon; tint: { bg: string; accent: string }; verb: string }> = {
  application_awarded: { icon: Award01Icon, tint: { bg: '#EDF9F1', accent: C.success }, verb: 'awarded a grant to' },
  application_declined: { icon: CancelCircleIcon, tint: { bg: '#FDEFF2', accent: C.danger }, verb: 'declined' },
  application_shortlisted: { icon: CheckmarkCircle02Icon, tint: { bg: '#F5F4FF', accent: '#8B7FF0' }, verb: 'shortlisted' },
  application_commented: { icon: Message01Icon, tint: { bg: '#EEF6FE', accent: C.info }, verb: 'commented on' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────────

function Dashboard() {
  const d = Route.useLoaderData()

  // Brand-new tenant: nothing exists yet → onboarding.
  if (d.pipeline.total === 0 && d.rounds.length === 0 && d.money.totalAwarded === 0) {
    return <Onboarding name={d.name} />
  }

  const a = d.attention
  const round = d.focusRoundBreakdown

  // ── "On your desk" — the attention queue as narrated actions ────────────────
  const paymentsDue = a.paymentsOverdue.count + a.paymentsDueSoon.count
  const desk: Array<React.ComponentProps<typeof DeskRow>> = []
  if (a.toReview.count > 0)
    desk.push({ icon: Files01Icon, iconTint: { bg: KPI.apps.bg, accent: KPI.apps.accent }, lead: `${a.toReview.count} application${plural(a.toReview.count)}`, rest: 'ready to review', tag: 'Applications', to: '/applications', search: { roundId: undefined, status: 'for_review' } })
  if (paymentsDue > 0)
    desk.push({ icon: Coins01Icon, iconTint: { bg: KPI.finance.bg, accent: KPI.finance.accent }, lead: `${paymentsDue} payment${plural(paymentsDue)}`, rest: 'due to be paid', tag: 'Finance', to: '/awards', search: { roundId: undefined } })
  if (d.awaitingVotes > 0)
    desk.push({ icon: CheckListIcon, iconTint: { bg: '#EEF6FE', accent: C.info }, lead: `${d.awaitingVotes} application${plural(d.awaitingVotes)}`, rest: 'await a trustee vote', tag: 'Review', to: '/shortlist', search: { roundId: undefined } })
  if (a.readyToAward.count > 0)
    desk.push({ icon: Award01Icon, iconTint: { bg: '#FDEFF2', accent: '#E0568A' }, lead: `${a.readyToAward.count} award${plural(a.readyToAward.count)}`, rest: 'ready to set up', tag: 'Giving', to: '/shortlist', search: { roundId: undefined } })
  if (d.reportsToReview > 0)
    desk.push({ icon: File01Icon, iconTint: { bg: KPI.reports.bg, accent: KPI.reports.accent }, lead: `${d.reportsToReview} report${plural(d.reportsToReview)}`, rest: 'to review', tag: 'Reports', to: '/reports' })

  // ── Round donut data (per-programme committed + an "unallocated" remainder) ──
  const donutData: DonutSlice[] = round
    ? [
        ...round.programmes.map((p, i) => ({ name: p.name, value: p.committed, color: PROG_COLORS[i % PROG_COLORS.length]! })),
        { name: 'Unallocated', value: Math.max(0, round.budget - round.committed), color: ALLOCATE_LEFT },
      ]
    : []
  const roundPct = round && round.budget > 0 ? Math.round((round.committed / round.budget) * 100) : 0
  const roundLeft = round ? Math.max(0, round.budget - round.committed) : 0
  const roundDaysLeft = daysUntil(round?.closedAt)

  // KPI category breakdowns — one source for both the chips and the bar-meter, so the
  // strip's colours always match the legend beneath it.
  const appsCats: Chip[] = [
    { label: 'to review', count: d.pipeline.for_review, color: KPI.apps.accent },
    { label: 'shortlisted', count: d.pipeline.shortlisted, color: withAlpha(KPI.apps.accent, 0.45) },
    { label: 'awarded', count: d.pipeline.awarded, color: C.success },
    { label: 'declined', count: d.pipeline.declined, color: C.danger },
  ]
  const reviewCats: Chip[] = [
    { label: 'approved', count: a.readyToAward.count, color: C.success },
    { label: 'to vote', count: d.awaitingVotes, color: C.warning },
  ]
  const reportsCats: Chip[] = [
    { label: 'to review', count: d.reportsToReview, color: C.info },
    { label: 'overdue', count: a.reportsOverdue.count, color: C.danger },
  ]
  const toSegments = (cats: Chip[]): BarSegment[] => cats.map((c) => ({ value: c.count, color: c.color }))
  const financeDenom = d.money.paidToDate + d.money.outstanding
  const financeProgress = financeDenom > 0 ? d.money.paidToDate / financeDenom : 0

  return (
    <div className="space-y-4">
      {/* Greeting — Figma: 20px medium, prefix grey (#97A1AF), name Gray/900 */}
      <h1 className="font-display text-[20px] font-medium">
        <span style={{ color: '#97A1AF' }}>{greeting()}, </span>
        <span style={{ color: C.ink }}>{firstName(d.name)}</span>
      </h1>

      {/* KPI candy row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          tint={KPI.apps}
          value={String(d.pipeline.total)}
          sub={`+${d.submittedThisWeek} this week`}
          subColor={C.success}
          icon={Files01Icon}
          label="Applications"
          to="/applications"
          search={{ roundId: undefined }}
          meter={<BarMeter segments={toSegments(appsCats)} color={KPI.apps.accent} />}
        >
          <Chips chips={appsCats} />
        </KpiCard>

        <KpiCard
          tint={KPI.review}
          value={String(a.shortlist.count)}
          sub={`${fmtCompact(a.shortlist.proposed)} proposed`}
          icon={CheckListIcon}
          label="Review"
          to="/shortlist"
          search={{ roundId: undefined }}
          meter={<BarMeter segments={toSegments(reviewCats)} color={KPI.review.accent} />}
        >
          <Chips chips={reviewCats} />
        </KpiCard>

        <KpiCard
          tint={KPI.finance}
          value={fmtCompact(d.paymentsThisMonth.amount)}
          sub={`${d.paymentsThisMonth.count} payment${plural(d.paymentsThisMonth.count)}`}
          icon={Coins01Icon}
          label="Finance"
          to="/awards"
          search={{ roundId: undefined }}
          meter={<BarMeter progress={financeProgress} color={KPI.finance.accent} />}
        >
          {/* TODO: bank-detail validation status (no verification model yet) */}
          <p className="mt-3 text-xs italic" style={{ color: C.faint }}>
            TODO · bank verification
          </p>
        </KpiCard>

        <KpiCard
          tint={KPI.reports}
          value={String(d.reportsToReview + a.reportsOverdue.count)}
          sub={a.reportsOverdue.count > 0 ? `${a.reportsOverdue.count} overdue` : 'up to date'}
          subColor={a.reportsOverdue.count > 0 ? C.danger : C.sub}
          icon={File01Icon}
          label="Reports"
          to="/reports"
          meter={<BarMeter segments={toSegments(reportsCats)} color={KPI.reports.accent} />}
        >
          <Chips chips={reportsCats} />
        </KpiCard>
      </div>

      {/* On your desk + Round */}
      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <Panel>
          <PanelTitle>On your desk</PanelTitle>
          {desk.length === 0 ? (
            <div className="flex items-center gap-3 py-6 text-sm" style={{ color: C.sub }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">✓</span>
              You’re all caught up — nothing needs action right now.
            </div>
          ) : (
            <div className="-mx-2 space-y-0.5">
              {desk.map((row, i) => (
                <DeskRow key={i} {...row} />
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          {round ? (
            <>
              <PanelTitle
                right={
                  roundDaysLeft != null && (
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                      style={{ backgroundColor: C.wash, color: C.sub }}
                    >
                      {roundDaysLeft > 0 ? `${roundDaysLeft} days left` : 'closed'}
                    </span>
                  )
                }
              >
                {round.roundName}
              </PanelTitle>
              <p className="-mt-2 mb-4 text-xs" style={{ color: C.sub }}>
                {fmtCompact(round.committed)} committed of {fmtCompact(round.budget)} budget
              </p>
              <div className="flex items-center gap-6">
                <Donut
                  data={donutData}
                  center={
                    <>
                      <div className="text-2xl font-semibold" style={{ color: C.ink }}>
                        {roundPct}%
                      </div>
                      <div className="mt-0.5 text-center text-[11px] leading-tight" style={{ color: C.sub }}>
                        {fmtCompact(roundLeft)} left
                        <br />
                        to allocate
                      </div>
                    </>
                  }
                />
                <div className="min-w-0 flex-1 space-y-3.5">
                  {round.programmes.length === 0 && (
                    <p className="text-sm" style={{ color: C.faint }}>
                      No programmes in this round yet.
                    </p>
                  )}
                  {round.programmes.map((p, i) => (
                    <div key={p.name}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[13px] font-medium" style={{ color: C.body }}>
                          {p.name}
                        </span>
                        <span className="shrink-0 text-xs" style={{ color: C.sub }}>
                          {fmtCompact(p.committed)} / {fmtCompact(p.budget)}
                        </span>
                      </div>
                      <ProgressBar
                        className="mt-1.5"
                        value={p.budget > 0 ? p.committed / p.budget : 0}
                        color={PROG_COLORS[i % PROG_COLORS.length]!}
                        track={C.wash}
                        delay={i * 90}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <PanelTitle>Current round</PanelTitle>
              <p className="py-8 text-center text-sm" style={{ color: C.faint }}>
                No active round.
              </p>
            </>
          )}
        </Panel>
      </div>

      {/* Giving + Lately */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Panel>
          <GivingSoFar giving={d.giving} />
        </Panel>

        <Panel>
          <PanelTitle>Lately</PanelTitle>
          {d.lately.length === 0 ? (
            <p className="py-4 text-sm" style={{ color: C.faint }}>
              No activity yet.
            </p>
          ) : (
            <div className="space-y-1">
              {d.lately.map((ev) => {
                const meta = LATELY_META[ev.action]
                if (!meta) return null
                const org = ev.organisationName ?? 'an application'
                const inner = (
                  <>
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: meta.tint.bg }}
                    >
                      <HugeiconsIcon icon={meta.icon} className="h-4 w-4" strokeWidth={1.7} style={{ color: meta.tint.accent }} />
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug" style={{ color: C.body }}>
                      <span className="font-semibold" style={{ color: C.ink }}>
                        {ev.actorName ?? 'Someone'}
                      </span>{' '}
                      {meta.verb}{' '}
                      <span className="font-medium" style={{ color: C.ink }}>
                        {org}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px]" style={{ color: C.faint }}>
                      {relativeTime(ev.at)}
                    </span>
                  </>
                )
                return ev.applicationId ? (
                  <Link
                    key={ev.id}
                    to="/applications/$applicationId"
                    params={{ applicationId: ev.applicationId }}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[#FAFAFB]"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={ev.id} className="flex items-center gap-3 px-2 py-2">
                    {inner}
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ─── Giving so far (with range toggle) ────────────────────────────────────────────

function GivingSoFar({ giving }: { giving: DashboardData['giving'] }) {
  const [range, setRange] = useState<'quarter' | 'ytd' | 'allTime'>('ytd')
  const ranges = [
    { key: 'quarter', label: 'Quarter' },
    { key: 'ytd', label: 'Year to date' },
    { key: 'allTime', label: 'All time' },
  ] as const
  const headline = giving[range]
  const series = giving.series[range]

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
          Giving so far
        </h2>
        <div className="inline-flex rounded-lg p-0.5" style={{ backgroundColor: C.wash }}>
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
              style={
                range === r.key
                  ? { backgroundColor: '#fff', color: C.ink, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }
                  : { color: C.sub }
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-[34px] font-semibold leading-none" style={{ color: C.ink }}>
          {fmtCompact(headline)}
        </span>
        {giving.quarter > 0 && (
          <span className="text-sm font-medium" style={{ color: C.success }}>
            +{fmtCompact(giving.quarter)} this quarter
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs" style={{ color: C.sub }}>
        across {giving.grants} grant{plural(giving.grants)}
      </p>

      <div className="mt-4">
        {series.length > 0 ? (
          <GivingArea data={series} />
        ) : (
          <p className="py-10 text-center text-sm" style={{ color: C.faint }}>
            No giving recorded in this period yet.
          </p>
        )}
      </div>
    </>
  )
}

// ─── Onboarding (brand-new tenant) ─────────────────────────────────────────────────

function Onboarding({ name }: { name: string }) {
  const steps = [
    { n: '1', title: 'Create a round', body: 'Set up a funding round and the programmes within it.', to: '/rounds', cta: 'Go to rounds' },
    { n: '2', title: 'Add programmes', body: 'Define programmes, budgets and grant limits.', to: '/programmes', cta: 'Go to programmes' },
    { n: '3', title: 'Connect intake', body: 'Generate an API key so applications can flow in.', to: '/users', cta: 'Organisation' },
  ]
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: C.ink }}>
          {greeting()}, {firstName(name)}.
        </h1>
        <p className="mt-0.5 text-sm" style={{ color: C.sub }}>
          Let’s get your foundation set up
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <UiCard key={s.n} className="p-5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-700">{s.n}</span>
            <p className="mt-3 text-sm font-medium text-gray-900">{s.title}</p>
            <p className="mt-1 text-xs text-gray-500">{s.body}</p>
            <Link to={s.to} className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:text-emerald-800">
              {s.cta} →
            </Link>
          </UiCard>
        ))}
      </div>
    </div>
  )
}
