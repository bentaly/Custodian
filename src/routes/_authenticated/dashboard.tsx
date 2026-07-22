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
      className={`rounded-2xl border bg-white p-5 ${className}`}
      style={{ borderColor: C.line }}
    >
      {children}
    </div>
  )
}

function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

// A decorative bar strip behind each KPI — a light→accent gradient of thin bars.
// Deterministic heights so it's stable across renders; purely a visual motif.
function SparkStrip({ accent }: { accent: string }) {
  const n = 30
  return (
    <div className="mt-3 flex h-8 items-end gap-[3px]">
      {Array.from({ length: n }).map((_, i) => {
        const h = 45 + Math.round(38 * Math.abs(Math.sin(i * 0.9 + 1)) + (i / n) * 18)
        const t = i / (n - 1)
        return (
          <span
            key={i}
            className="flex-1 rounded-sm"
            style={{ height: `${Math.min(100, h)}%`, backgroundColor: accent, opacity: 0.35 + t * 0.55 }}
          />
        )
      })}
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
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      search={search}
      className="flex flex-col rounded-2xl border p-4 transition-shadow hover:shadow-sm"
      style={{ backgroundColor: tint.bg, borderColor: tint.border }}
    >
      <div className="text-[30px] font-semibold leading-none" style={{ color: C.ink }}>
        {value}
      </div>
      <div className="mt-1.5 text-xs font-medium" style={{ color: subColor ?? C.sub }}>
        {sub}
      </div>
      <SparkStrip accent={tint.accent} />
      {children}
      <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
        <HugeiconsIcon icon={icon} className="h-4 w-4" strokeWidth={1.6} style={{ color: C.sub }} />
        <span className="text-[13px] font-medium" style={{ color: C.body }}>
          {label}
        </span>
      </div>
    </Link>
  )
}

// ─── Round-by-programme donut ────────────────────────────────────────────────────

function RoundDonut({
  segments,
  budget,
  committed,
}: {
  segments: Array<{ amount: number; color: string }>
  budget: number
  committed: number
}) {
  const r = 52
  const circ = 2 * Math.PI * r
  const denom = budget > 0 ? budget : Math.max(committed, 1)
  const pct = budget > 0 ? Math.round((committed / budget) * 100) : 0
  const left = Math.max(0, budget - committed)

  let offset = 0
  const arcs = segments
    .filter((s) => s.amount > 0)
    .map((s, i) => {
      const len = (s.amount / denom) * circ
      const el = (
        <circle
          key={i}
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={s.color}
          strokeWidth="16"
          strokeDasharray={`${len} ${circ - len}`}
          strokeDashoffset={-offset}
          strokeLinecap="butt"
        />
      )
      offset += len
      return el
    })

  return (
    <div className="relative h-[140px] w-[140px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke={ALLOCATE_LEFT} strokeWidth="16" />
        {arcs}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-semibold" style={{ color: C.ink }}>
          {pct}%
        </div>
        <div className="mt-0.5 text-center text-[11px] leading-tight" style={{ color: C.sub }}>
          {fmtCompact(left)} left
          <br />
          to allocate
        </div>
      </div>
    </div>
  )
}

// ─── Giving chart (monthly area) ─────────────────────────────────────────────────

function GivingChart({ data }: { data: Array<{ label: string; amount: number }> }) {
  const W = 640
  const H = 200
  const padL = 40
  const padR = 8
  const padT = 12
  const padB = 24
  const rawMax = Math.max(1, ...data.map((d) => d.amount))
  // Round the axis up to a "nice" step so gridlines read cleanly.
  const step = rawMax > 400_000 ? 200_000 : rawMax > 100_000 ? 100_000 : rawMax > 20_000 ? 20_000 : 5_000
  const max = Math.ceil(rawMax / step) * step
  const ticks = 4
  const n = data.length
  const x = (i: number) => (n <= 1 ? padL : padL + (i * (W - padL - padR)) / (n - 1))
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB)
  const pts = data.map((d, i) => `${x(i)},${y(d.amount)}`)
  const line = pts.length ? `M${pts.join(' L')}` : ''
  const area = pts.length ? `M${x(0)},${H - padB} L${pts.join(' L')} L${x(n - 1)},${H - padB} Z` : ''

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="givingFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B7FF0" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#8B7FF0" stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = (max / ticks) * (ticks - i)
        const yy = y(v)
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke={C.line} strokeWidth="1" strokeDasharray="2 3" />
            <text x={padL - 6} y={yy + 3} textAnchor="end" fontSize="9" fill={C.faint}>
              {v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
            </text>
          </g>
        )
      })}
      {area && <path d={area} fill="url(#givingFill)" />}
      {line && <path d={line} fill="none" stroke="#8B7FF0" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.amount)} r="2.5" fill="#8B7FF0" />
      ))}
      {data.map((d, i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill={C.faint}>
          {d.label}
        </text>
      ))}
    </svg>
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

  // ── Round donut segments ────────────────────────────────────────────────────
  const segments = (round?.programmes ?? []).map((p, i) => ({ amount: p.committed, color: PROG_COLORS[i % PROG_COLORS.length]! }))
  const roundDaysLeft = daysUntil(round?.closedAt)

  return (
    <div className="space-y-5">
      {/* Greeting */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: C.ink }}>
          {greeting()}, {firstName(d.name)}.
        </h1>
      </div>

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
        >
          <Chips
            chips={[
              { label: 'to review', count: d.pipeline.for_review, color: C.info },
              { label: 'shortlisted', count: d.pipeline.shortlisted, color: C.warning },
              { label: 'awarded', count: d.pipeline.awarded, color: C.success },
              { label: 'declined', count: d.pipeline.declined, color: C.faint },
            ]}
          />
        </KpiCard>

        <KpiCard
          tint={KPI.review}
          value={String(a.shortlist.count)}
          sub={`${fmtCompact(a.shortlist.proposed)} proposed`}
          icon={CheckListIcon}
          label="Review"
          to="/shortlist"
          search={{ roundId: undefined }}
        >
          <Chips
            chips={[
              { label: 'approved', count: a.readyToAward.count, color: C.success },
              { label: 'to vote', count: d.awaitingVotes, color: C.warning },
            ]}
          />
        </KpiCard>

        <KpiCard
          tint={KPI.finance}
          value={fmtCompact(d.paymentsThisMonth.amount)}
          sub={`${d.paymentsThisMonth.count} payment${plural(d.paymentsThisMonth.count)}`}
          icon={Coins01Icon}
          label="Finance"
          to="/awards"
          search={{ roundId: undefined }}
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
        >
          <Chips
            chips={[
              { label: 'to review', count: d.reportsToReview, color: C.info },
              { label: 'overdue', count: a.reportsOverdue.count, color: C.danger },
            ]}
          />
        </KpiCard>
      </div>

      {/* On your desk + Round */}
      <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
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
                <RoundDonut segments={segments} budget={round.budget} committed={round.committed} />
                <div className="min-w-0 flex-1 space-y-3.5">
                  {round.programmes.length === 0 && (
                    <p className="text-sm" style={{ color: C.faint }}>
                      No programmes in this round yet.
                    </p>
                  )}
                  {round.programmes.map((p, i) => {
                    const pct = p.budget > 0 ? Math.min(100, Math.round((p.committed / p.budget) * 100)) : 0
                    return (
                      <div key={p.name}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-medium" style={{ color: C.body }}>
                            {p.name}
                          </span>
                          <span className="shrink-0 text-xs" style={{ color: C.sub }}>
                            {fmtCompact(p.committed)} / {fmtCompact(p.budget)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: C.wash }}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${pct}%`, backgroundColor: PROG_COLORS[i % PROG_COLORS.length] }}
                          />
                        </div>
                      </div>
                    )
                  })}
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
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
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

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold" style={{ color: C.ink }}>
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
        {giving.monthly.length > 0 ? (
          <GivingChart data={giving.monthly} />
        ) : (
          <p className="py-10 text-center text-sm" style={{ color: C.faint }}>
            No giving recorded this year yet.
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
