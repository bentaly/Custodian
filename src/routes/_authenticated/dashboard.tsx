import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { getDashboard } from '../../server/fns/dashboard'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'

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

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}
function fmtDate(date: Date | string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
function relativeTime(date: Date | string) {
  const mins = Math.round((Date.now() - new Date(date).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return fmtDate(date)
}
function daysUntil(date: Date | string | null | undefined): number | null {
  if (!date) return null
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)
}
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
function firstName(name: string) {
  return name.split(' ')[0] || name
}

const PALETTE = ['#1D9E75', '#3B82C4', '#C2843B', '#8B5C9E', '#C44B6E', '#4F9E8C', '#A89B3B', '#9CA3AF']

// ─── Layout primitives ────────────────────────────────────────────────────────

function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-white">
      {title && (
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{title}</h2>
          {action}
        </div>
      )}
      <div className="flex-1 px-5 py-4">{children}</div>
    </div>
  )
}

// ─── Charts (hand-rolled SVG, no chart dependency) ─────────────────────────────

function Donut({ data }: { data: Array<{ name: string; amount: number }> }) {
  const total = data.reduce((s, d) => s + d.amount, 0)
  const top = data.slice(0, 6)
  const restAmount = data.slice(6).reduce((s, d) => s + d.amount, 0)
  const segments = top.map((d, i) => ({ ...d, color: PALETTE[i] }))
  if (restAmount > 0) segments.push({ name: 'Other', amount: restAmount, color: PALETTE[7] })

  const r = 56
  const circ = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0 -rotate-90">
        <circle cx="70" cy="70" r={r} fill="none" stroke="#f1f1ee" strokeWidth="16" />
        {total > 0 &&
          segments.map((s) => {
            const len = (s.amount / total) * circ
            const el = (
              <circle
                key={s.name}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${circ - len}`}
                strokeDashoffset={-offset}
              />
            )
            offset += len
            return el
          })}
      </svg>
      <div className="min-w-0 flex-1 space-y-1.5">
        {segments.length === 0 && <p className="text-sm text-gray-400">No awards yet.</p>}
        {segments.map((s) => (
          <div key={s.name} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="truncate text-gray-600" title={s.name}>
              {s.name}
            </span>
            <span className="ml-auto shrink-0 font-medium text-gray-800">{fmtCompact(s.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TrendArea({ data }: { data: Array<{ weekStart: string; count: number }> }) {
  const W = 300
  const H = 96
  const pad = 6
  const max = Math.max(1, ...data.map((d) => d.count))
  const n = data.length
  const x = (i: number) => (n <= 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1))
  const y = (v: number) => H - pad - (v / max) * (H - 2 * pad)
  const pts = data.map((d, i) => `${x(i)},${y(d.count)}`)
  const line = pts.length ? `M${pts.join(' L')}` : ''
  const area = pts.length ? `M${x(0)},${H - pad} L${pts.join(' L')} L${x(n - 1)},${H - pad} Z` : ''
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-2xl font-semibold text-gray-900">{total}</p>
        <p className="text-xs text-gray-400">submissions · 12 weeks</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1D9E75" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#1D9E75" stopOpacity="0" />
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#trendFill)" />}
        {line && <path d={line} fill="none" stroke="#1D9E75" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {data.map((dp, i) => (dp.count > 0 ? <circle key={i} cx={x(i)} cy={y(dp.count)} r="2" fill="#0F6E56" /> : null))}
      </svg>
    </div>
  )
}

const SCORE_COLORS: Record<string, string> = {
  '90plus': '#0F6E56',
  '80to89': '#1D9E75',
  '70to79': '#5BAE91',
  '60to69': '#C2843B',
  below60: '#C46B6B',
}

function ScoreBars({ data }: { data: Array<{ key: string; label: string; count: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((s, d) => s + d.count, 0)
  if (total === 0) return <p className="py-8 text-center text-sm text-gray-400">No scored applications yet.</p>
  return (
    <div className="flex h-32 items-end justify-between gap-2">
      {data.map((d) => (
        <div key={d.key} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[11px] font-medium text-gray-500">{d.count}</span>
          <div className="flex w-full flex-1 items-end">
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(2, (d.count / max) * 100)}%`, backgroundColor: SCORE_COLORS[d.key] ?? '#9CA3AF' }}
            />
          </div>
          <span className="text-[10px] text-gray-400">{d.label}</span>
        </div>
      ))}
    </div>
  )
}

type FunnelData = { roundName: string; submitted: number; shortlisted: number; awarded: number; declined: number }

function Funnel({ data }: { data: FunnelData | null }) {
  if (!data || data.submitted === 0) {
    return <p className="py-10 text-center text-sm text-gray-400">No applications in this round yet.</p>
  }
  const stages = [
    { label: 'Submitted', n: data.submitted, color: '#94A3B8' },
    { label: 'Shortlisted', n: data.shortlisted, color: '#3B82C4' },
    { label: 'Awarded', n: data.awarded, color: '#1D9E75' },
  ]
  const W = 300
  const H = 120
  const cy = H / 2 + 6 // leave headroom for the count labels above each segment
  const segW = W / stages.length
  const maxH = H - 28
  // Height is fully proportional to the count; a 3px floor keeps a nonzero stage visible.
  const heightFor = (n: number) => Math.max(3, (n / data.submitted) * maxH)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full">
        {stages.map((s, i) => {
          const x0 = i * segW
          const x1 = x0 + segW
          const hL = heightFor(s.n)
          const hR = heightFor(stages[i + 1]?.n ?? s.n) // taper toward the next stage
          const pts = [
            [x0, cy - hL / 2],
            [x1, cy - hR / 2],
            [x1, cy + hR / 2],
            [x0, cy + hL / 2],
          ]
            .map((p) => p.join(','))
            .join(' ')
          return (
            <g key={s.label}>
              <polygon points={pts} fill={s.color} />
              <text x={x0 + segW / 2} y={cy - hL / 2 - 6} textAnchor="middle" fontSize="14" fontWeight="600" fill={s.color}>
                {s.n}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="mt-3 space-y-1.5">
        {stages.map((s, i) => {
          const prev = i === 0 ? null : (stages[i - 1]?.n ?? null)
          const pct = prev && prev > 0 ? Math.round((s.n / prev) * 100) : null
          return (
            <div key={s.label} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
              <span className="text-gray-600">{s.label}</span>
              <span className="ml-auto font-medium text-gray-800">{s.n}</span>
              {pct != null && <span className="w-12 shrink-0 text-right text-gray-400">{pct}%</span>}
              {pct == null && <span className="w-12 shrink-0" />}
            </div>
          )
        })}
      </div>
      {data.declined > 0 && (
        <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-gray-400">{data.declined} declined</p>
      )}
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, to, search }: { label: string; value: string; sub?: string; to: string; search?: Record<string, unknown> }) {
  return (
    <Link
      to={to}
      search={search}
      className="rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300 hover:bg-gray-50"
    >
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </Link>
  )
}

// ─── Attention queue ──────────────────────────────────────────────────────────

type Lane = {
  key: string
  sev: 'red' | 'amber' | 'green' | 'neutral'
  title: string
  detail?: string
  to: string
  search?: Record<string, unknown>
  cta: string
  priority: number
}

const SEV_STYLE: Record<Lane['sev'], { dot: string; bg: string; border: string; title: string; cta: string }> = {
  red: { dot: '#A32D2D', bg: '#FCEBEB', border: '#F3D2D2', title: '#791F1F', cta: '#A32D2D' },
  amber: { dot: '#854F0B', bg: '#FBF1DF', border: '#EED9A0', title: '#633806', cta: '#854F0B' },
  green: { dot: '#0F6E56', bg: '#E6F4EF', border: '#BFE3D6', title: '#0F6E56', cta: '#0F6E56' },
  neutral: { dot: '#9CA3AF', bg: '#F7F7F4', border: '#ECECE6', title: '#444444', cta: '#666666' },
}
const SEV_ORDER: Lane['sev'][] = ['red', 'amber', 'green', 'neutral']

function AttentionLane({ lane }: { lane: Lane }) {
  const s = SEV_STYLE[lane.sev]
  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2.5" style={{ backgroundColor: s.bg, border: `0.5px solid ${s.border}` }}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.dot }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium" style={{ color: s.title }}>
          {lane.title}
        </p>
        {lane.detail && (
          <p className="truncate text-xs" style={{ color: s.cta }} title={lane.detail}>
            {lane.detail}
          </p>
        )}
      </div>
      <Link
        to={lane.to}
        search={lane.search}
        className="shrink-0 rounded border bg-white px-2.5 py-1 text-[11px] font-medium hover:bg-gray-50"
        style={{ borderColor: s.border, color: s.cta }}
      >
        {lane.cta}
      </Link>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function Dashboard() {
  const d = Route.useLoaderData()
  const isTrustee = d.role === 'trustee'
  const isFinance = d.role === 'finance'

  // Brand-new tenant: nothing exists yet → onboarding.
  if (d.pipeline.total === 0 && d.rounds.length === 0 && d.money.totalAwarded === 0) {
    return <Onboarding name={d.name} />
  }

  const names = (items: Array<{ organisationName: string | null }>) =>
    items.slice(0, 3).map((i) => i.organisationName ?? 'Direct grant').join(', ')

  // ── Attention lanes (only those with something to act on) ────────────────────
  const a = d.attention
  const lanes: Lane[] = []
  const plural = (n: number) => (n !== 1 ? 's' : '')
  if (a.reportsOverdue.count > 0)
    lanes.push({ key: 'rep-od', sev: 'red', priority: isFinance ? 0 : 3, to: '/record', search: { roundId: undefined }, cta: 'View', title: `${a.reportsOverdue.count} grant report${plural(a.reportsOverdue.count)} overdue`, detail: names(a.reportsOverdue.items) })
  if (a.paymentsOverdue.count > 0)
    lanes.push({ key: 'pay-od', sev: 'red', priority: isFinance ? 1 : 4, to: '/record', search: { roundId: undefined }, cta: 'View', title: `${a.paymentsOverdue.count} payment${plural(a.paymentsOverdue.count)} overdue`, detail: names(a.paymentsOverdue.items) })
  if (a.dueDiligenceFlags > 0)
    lanes.push({ key: 'dd', sev: 'red', priority: 5, to: '/applications', search: { roundId: undefined, status: 'for_review' }, cta: 'Resolve', title: `${a.dueDiligenceFlags} due-diligence flag${plural(a.dueDiligenceFlags)} to resolve` })
  if (isTrustee && a.awaitingMyVote.count > 0)
    lanes.push({ key: 'vote', sev: 'amber', priority: 0, to: '/shortlist', search: { roundId: undefined }, cta: 'Vote', title: `${a.awaitingMyVote.count} application${plural(a.awaitingMyVote.count)} awaiting your vote`, detail: names(a.awaitingMyVote.items) })
  if (a.readyToAward.count > 0)
    lanes.push({ key: 'award', sev: 'green', priority: 2, to: '/shortlist', search: { roundId: undefined }, cta: 'Set up', title: `${a.readyToAward.count} approved — ready to award`, detail: names(a.readyToAward.items) })
  if (a.reportsDueSoon.count > 0)
    lanes.push({ key: 'rep-soon', sev: 'amber', priority: isFinance ? 2 : 6, to: '/record', search: { roundId: undefined }, cta: 'View', title: `${a.reportsDueSoon.count} report${plural(a.reportsDueSoon.count)} due within 30 days` })
  if (a.paymentsDueSoon.count > 0)
    lanes.push({ key: 'pay-soon', sev: 'amber', priority: isFinance ? 3 : 7, to: '/record', search: { roundId: undefined }, cta: 'View', title: `${a.paymentsDueSoon.count} payment${plural(a.paymentsDueSoon.count)} due within 30 days` })
  if (a.toReview.count > 0 && !isTrustee)
    lanes.push({ key: 'review', sev: 'neutral', priority: 1, to: '/applications', search: { roundId: undefined, status: 'for_review' }, cta: 'Review', title: `${a.toReview.count} application${plural(a.toReview.count)} awaiting review`, detail: names(a.toReview.items) })
  if (a.scoringPending > 0 && !isTrustee)
    lanes.push({ key: 'scoring', sev: 'neutral', priority: 9, to: '/applications', search: { roundId: undefined, status: 'for_review' }, cta: 'View', title: `${a.scoringPending} awaiting AI assessment` })
  lanes.sort((x, y) => x.priority - y.priority || SEV_ORDER.indexOf(x.sev) - SEV_ORDER.indexOf(y.sev))

  // ── Role-aware first KPI ─────────────────────────────────────────────────────
  const firstKpi = isTrustee
    ? { label: 'Awaiting your vote', value: String(a.awaitingMyVote.count), sub: `${a.shortlist.count} shortlisted`, to: '/shortlist', search: { roundId: undefined } as Record<string, unknown> }
    : { label: 'Awaiting review', value: String(d.pipeline.for_review), sub: 'applications', to: '/applications', search: { roundId: undefined, status: 'for_review' } as Record<string, unknown> }

  // ── Rounds: open first, then most recent ─────────────────────────────────────
  const rank = (r: { openedAt: Date | null; closedAt: Date | null }) => {
    const s = getRoundStatus(r)
    return s === 'open' ? 0 : s === 'upcoming' ? 1 : 2
  }
  const sortedRounds = [...d.rounds]
    .sort((x, y) => rank(x) - rank(y) || (y.openedAt ? new Date(y.openedAt).getTime() : 0) - (x.openedAt ? new Date(x.openedAt).getTime() : 0))
    .slice(0, 4)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, fontWeight: 400 }} className="text-gray-900">
          {greeting()}, {firstName(d.name)}.
        </h1>
        <p className="mt-0.5 text-sm text-gray-400">
          {d.openRoundName ? (
            <>
              <span className="text-gray-500">{d.openRoundName}</span> is open for applications
            </>
          ) : (
            'Here’s where things stand today'
          )}
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi {...firstKpi} />
        <Kpi label="Shortlisted" value={String(a.shortlist.count)} sub={`${fmtCompact(a.shortlist.proposed)} proposed`} to="/shortlist" search={{ roundId: undefined }} />
        <Kpi label="Total awarded" value={fmtCompact(d.money.totalAwarded)} sub={`${d.money.activeGrants} active grant${plural(d.money.activeGrants)}`} to="/record" search={{ roundId: undefined }} />
        <Kpi label="Outstanding to pay" value={fmtCompact(d.money.outstanding)} sub={`${fmtCompact(d.money.paidToDate)} paid to date`} to="/record" search={{ roundId: undefined }} />
      </div>

      {/* Attention + Rounds */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Needs attention">
            {lanes.length === 0 ? (
              <div className="flex items-center gap-3 py-6 text-sm text-gray-500">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">✓</span>
                You’re all caught up — nothing needs action right now.
              </div>
            ) : (
              <div className="space-y-2">
                {lanes.map((l) => (
                  <AttentionLane key={l.key} lane={l} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card title="Active rounds" action={<Link to="/rounds" className="text-xs text-gray-400 hover:text-gray-600">All</Link>}>
          {sortedRounds.length === 0 ? (
            <p className="py-4 text-sm text-gray-400">No rounds yet.</p>
          ) : (
            <div className="space-y-3.5">
              {sortedRounds.map((r) => {
                const status = getRoundStatus(r)
                const left = status === 'open' ? daysUntil(r.closedAt) : null
                const pct = r.budget > 0 ? Math.min(100, Math.round((r.committed / r.budget) * 100)) : 0
                return (
                  <div key={r.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-gray-800">{r.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${ROUND_STATUS_COLORS[status]}`}>
                        {ROUND_STATUS_LABELS[status]}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                      <span>
                        {r.applicationCount} application{plural(r.applicationCount)}
                      </span>
                      <span>
                        {left != null ? (left >= 0 ? `closes in ${left}d` : 'closed') : r.closedAt ? `closed ${fmtDate(r.closedAt)}` : ''}
                      </span>
                    </div>
                    {r.budget > 0 && (
                      <>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? '#C2843B' : '#1D9E75' }} />
                        </div>
                        <p className="mt-1 text-[11px] text-gray-400">
                          {fmtCompact(r.committed)} of {fmtCompact(r.budget)} committed ({pct}%)
                        </p>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title="Pipeline"
          action={d.funnel && <span className="max-w-[55%] truncate text-[11px] text-gray-400" title={d.funnel.roundName}>{d.funnel.roundName}</span>}
        >
          <Funnel data={d.funnel} />
        </Card>
        <Card title="Awards by programme">
          <Donut data={d.money.byProgramme} />
        </Card>
        <Card title="Score distribution">
          <ScoreBars data={d.scoreDistribution} />
        </Card>
      </div>

      {/* Trend + Activity */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Submissions over time">
            <TrendArea data={d.submissionsTrend} />
          </Card>
        </div>
        <Card title="Recent activity">
          {d.activity.length === 0 ? (
            <p className="py-4 text-sm text-gray-400">No recent activity.</p>
          ) : (
            <div className="space-y-2.5">
              {d.activity.map((ev) => (
                <Link
                  key={`${ev.type}-${ev.applicationId}`}
                  to="/applications/$applicationId"
                  params={{ applicationId: ev.applicationId }}
                  className="flex items-center gap-2.5 text-sm hover:opacity-80"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: ev.type === 'awarded' ? '#1D9E75' : ev.type === 'declined' ? '#C46B6B' : '#9CA3AF' }} />
                  <span className="min-w-0 flex-1 truncate text-gray-700">{ev.organisationName}</span>
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {ev.type === 'submitted' ? 'submitted' : ev.type === 'awarded' ? 'awarded' : 'declined'} · {relativeTime(ev.at)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function Onboarding({ name }: { name: string }) {
  const steps = [
    { n: '1', title: 'Create a round', body: 'Set up a funding round and the programmes within it.', to: '/rounds', cta: 'Go to rounds' },
    { n: '2', title: 'Add programmes', body: 'Define programmes, budgets and grant limits.', to: '/programmes', cta: 'Go to programmes' },
    { n: '3', title: 'Connect intake', body: 'Generate an API key so applications can flow in.', to: '/users', cta: 'Organisation' },
  ]
  return (
    <div className="space-y-5">
      <div>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, fontWeight: 400 }} className="text-gray-900">
          {greeting()}, {firstName(name)}.
        </h1>
        <p className="mt-0.5 text-sm text-gray-400">Let’s get your foundation set up</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div key={s.n} className="rounded-lg border border-gray-200 bg-white p-5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-50 text-sm font-semibold text-emerald-700">{s.n}</span>
            <p className="mt-3 text-sm font-medium text-gray-900">{s.title}</p>
            <p className="mt-1 text-xs text-gray-500">{s.body}</p>
            <Link
              to={s.to}
              className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:text-emerald-800"
            >
              {s.cta} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
