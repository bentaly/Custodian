import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { ACTION_VERB, type FeedAction } from '../../lib/audit'
import {
  Audit02Icon,
  CheckmarkCircle02Icon,
  CheckmarkSquare01Icon,
  CancelSquareIcon,
  BubbleChatIcon,
  BankIcon,
  BanknoteIcon,
  BanknoteXIcon,
  UserSwitchIcon,
  TaskDone01Icon,
  ArrowRight01Icon,
} from '@hugeicons/core-free-icons'
import { Card as UiCard, TextLink } from '../../components/ui'
import { AREA_ICON } from '../../components/Sidebar'
import { BarMeter, type BarSegment, withAlpha } from '../../components/BarMeter'
import { ProgressBar } from '../../components/ProgressBar'
import { Donut, type DonutSlice } from '../../components/charts/Donut'
import { GivingArea } from '../../components/charts/GivingArea'
import { getDashboard } from '../../server/fns/dashboard'
import { fmtCompact } from '../../lib/format'
import { C, PROGRAMME_COLOURS, tint as T } from '../../components/ui/tokens'

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

// KPI card tints: { bg, border, accent } per metric.
const KPI = {
  apps: {
    bg: T('accent-violet', 10),
    border: T('accent-violet', 20),
    accent: 'var(--color-accent-violet)',
  },
  review: { bg: T('success', 10), border: T('success', 20), accent: 'var(--color-success)' },
  // Finance and Reports are ACCENT cards, not status cards (Figma 126:31795): warm amber
  // and blush. They were wired to `warning` / `danger`, which is the same mistake twice —
  // a card is not a status, and the semantic hues were darkened for text contrast on
  // 2026-08-12, so Finance became a brown card and Reports a red one. Nothing on either
  // is an alarm: `£102k paid this month` is not a warning, and a report waiting to be
  // read is not an error. The genuinely bad news inside them still reaches for the
  // semantic hues — overdue reports, bank-detail issues — and now stands out because the
  // card around it no longer shouts.
  // All four sit at the SAME 10% fill / 20% border as the `MiniKpi` stat rows, which is
  // what the comps draw (126:31795, 435:38511). Finance and Reports were at 20/40 —
  // twice the saturation of the two beside them, so a row of four cards read as two
  // pairs, and the two shouting were the ones whose news is routine.
  finance: {
    bg: T('accent-amber', 10),
    border: T('accent-amber', 20),
    accent: 'var(--color-accent-amber)',
  },
  reports: {
    bg: T('accent-blush', 10),
    border: T('accent-blush', 20),
    accent: 'var(--color-accent-blush)',
  },
}

// The Reports card's two chip shades (Figma 126:34555 / 126:34511) — the light pink is
// also the colour of the leading number in its sub-line.
const REPORTS_CHIP = { toReview: 'var(--color-accent-blush)', overdue: 'var(--color-danger)' }

// Round donut / programme-bar palette.
const PROG_COLOURS = PROGRAMME_COLOURS
const ALLOCATE_LEFT = 'var(--color-grey-200)'

// ─── Formatting helpers ─────────────────────────────────────────────────────────

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
      className={`rounded-card border bg-white p-4 ${className}`}
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
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

type Chip = { label: string; count: number; colour: string }

function Chips({ chips }: { chips: Chip[] }) {
  // Only categories that actually have something in them — "0 declined" is noise,
  // and it has to match the bar-meter, which drops empty segments too.
  const shown = chips.filter((c) => c.count > 0)
  if (!shown.length) return null
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-label"
      style={{ color: C.sub }}
    >
      {shown.map((c) => (
        <span key={c.label} className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.colour }} />
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
  subColour,
  icon,
  label,
  meta,
  to,
  search,
  meter,
  children,
}: {
  tint: { bg: string; border: string; accent: string }
  value: string
  /** A node, not just a string, so a card can colour part of the line (see Reports). */
  sub: React.ReactNode
  subColour?: string
  icon: IconSvgElement
  label: string
  /** Optional right-hand footer note (Figma 393:7930) — e.g. the round in focus. */
  meta?: string | null
  to: string
  search?: Record<string, unknown>
  meter: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      search={search}
      className="flex flex-col rounded-pill border bg-white p-1 transition-shadow hover:shadow-xs"
      style={{ borderColor: C.line }}
    >
      {/* Tinted inner panel (Figma 112:134) — inset 4px, holds the number/meter/chips. */}
      <div
        className="relative overflow-hidden rounded-card p-4"
        style={{ backgroundColor: tint.bg }}
      >
        {/* Figma "Mask group" (112:802): a radial accent gradient shown *through* a dot
            grid — the gradient is the fill, the dots are the mask. Top-right, offset up. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 z-0 aspect-square w-1/2 translate-y-[-17%]"
          style={{
            backgroundImage: `radial-gradient(50% 50% at 50% 50%, ${withAlpha(tint.accent, 0.5)} 0%, ${withAlpha(tint.accent, 0)} 100%)`,
            WebkitMaskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            maskImage: 'radial-gradient(circle, #000 1.1px, transparent 1.2px)',
            WebkitMaskSize: '7px 7px',
            maskSize: '7px 7px',
          }}
        />
        <div className="relative z-10">
          {/* Figma 112:739 — Inter Display Medium 32, Gray/900. */}
          <div
            className="font-display text-display font-medium leading-none"
            style={{ color: C.ink }}
          >
            {value}
          </div>
          <div className="mt-1.5 text-label font-medium" style={{ color: subColour ?? C.sub }}>
            {sub}
          </div>
          <div className="mt-3">{meter}</div>
          {children}
        </div>
      </div>
      {/* Footer on the white card — icon + label left, optional meta right (Figma 126:32567). */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            icon={icon}
            className="h-5 w-5 shrink-0"
            strokeWidth={1.6}
            style={{ color: C.sub }}
          />
          <span className="truncate text-body font-medium" style={{ color: C.ink }}>
            {label}
          </span>
        </span>
        {meta && (
          <span className="shrink-0 truncate text-label font-medium" style={{ color: C.sub }}>
            {meta}
          </span>
        )}
      </div>
    </Link>
  )
}

// ─── "On your desk" rows ──────────────────────────────────────────────────────────

// Figma 126:34573 — a neutral 40px tile (Gray/50 wash, Gray/500 glyph), 14px medium
// copy with the lead in Gray/900 and the rest in Gray/500, and a chevron affordance.
const DESK_TILE = 'var(--color-surface)'

/**
 * A row takes NO icon of its own: the glyph is the area's, read out of `AREA_ICON` by
 * where the row goes. A vote queue marked with one glyph here and another on the rail
 * teaches two marks for one place. Hand-picked icons had drifted (Shortlist wore
 * `note-03` and `money-saving-jar`, Finance's wallet pointed at Awards), which is why
 * the icon is derived rather than passed.
 */
function DeskRow({
  lead,
  rest,
  to,
  search,
}: {
  lead: string
  rest: string
  to: string
  search?: Record<string, unknown>
}) {
  const icon = AREA_ICON[to]
  return (
    <Link
      to={to}
      search={search}
      className="flex items-center gap-4 rounded-control px-2 py-2 transition-colors hover:bg-grey-50"
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-chip"
        style={{ backgroundColor: DESK_TILE }}
      >
        {icon && (
          <HugeiconsIcon
            icon={icon}
            className="h-5 w-5"
            strokeWidth={1.5}
            style={{ color: C.sub }}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 text-body font-medium" style={{ color: C.sub }}>
        <span style={{ color: C.ink }}>{lead}</span> {rest}
      </span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        className="h-4 w-4 shrink-0"
        strokeWidth={2}
        style={{ color: C.ink }}
      />
    </Link>
  )
}

// ─── "Lately" (audit log) rows ────────────────────────────────────────────────────

// Figma 126:39615 — one neutral tile for every row, and a Gray/500 glyph in all of them.
// The feed is a log, not a status board: colouring only the good/bad outcomes made the
// rest look like a different kind of row rather than reading as one list.
// Typed against `FeedAction`, not `string`: the panel silently rendered nothing for an
// action it didn't know, so adding one to the log and forgetting it here lost the row
// with no error anywhere. Now the compiler asks for the glyph.
//
// Only the glyph. The words live in `ACTION_VERB`, because the Activity screen and the
// CSV say the same things about the same actions, and three copies of "recorded a
// payment to" is three chances for them to stop agreeing.
const LATELY_ICON: Record<FeedAction, IconSvgElement> = {
  application_awarded: CheckmarkSquare01Icon,
  application_declined: CancelSquareIcon,
  application_shortlisted: CheckmarkCircle02Icon,
  application_commented: BubbleChatIcon,
  application_registration_set: Audit02Icon,
  grant_bank_details_changed: BankIcon,
  // The building is the account, the note is the money — `BankIcon` above already
  // means "where the money goes", so these two must not reuse it.
  grant_payment_recorded: BanknoteIcon,
  grant_payment_reversed: BanknoteXIcon,
  application_vote_recorded_by_admin: UserSwitchIcon,
  grant_report_reviewed: TaskDone01Icon,
}

// ─── Page ─────────────────────────────────────────────────────────────────────────

function Dashboard() {
  const d = Route.useLoaderData()
  const { user } = Route.useRouteContext()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

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
    desk.push({
      lead: `${a.toReview.count} application${plural(a.toReview.count)}`,
      rest: 'ready to review',
      to: '/applications',
      search: { roundId: undefined, status: 'for_review' },
    })
  if (paymentsDue > 0)
    desk.push({
      lead: `${paymentsDue} payment${plural(paymentsDue)}`,
      rest: 'due to be paid',
      // Finance, not Awards: this row is about money leaving, and Finance is the
      // payments lens over the same grants (To pay / Paid).
      to: '/finance',
    })
  if (d.awaitingVotes > 0)
    desk.push({
      lead: `${d.awaitingVotes} application${plural(d.awaitingVotes)}`,
      rest: 'await a trustee vote',
      to: '/shortlist',
      search: { roundId: undefined },
    })
  if (a.readyToAward.count > 0)
    desk.push({
      lead: `${a.readyToAward.count} award${plural(a.readyToAward.count)}`,
      rest: 'ready to set up',
      to: '/shortlist',
      search: { roundId: undefined },
    })
  if (d.reportsToReview > 0)
    desk.push({
      lead: `${d.reportsToReview} report${plural(d.reportsToReview)}`,
      rest: 'to review',
      to: '/reports',
    })

  // ── Round donut data (per-programme committed + an "unallocated" remainder) ──
  const donutData: DonutSlice[] = round
    ? [
        ...round.programmes.map((p, i) => ({
          name: p.name,
          value: p.committed,
          colour: PROG_COLOURS[i % PROG_COLOURS.length]!,
        })),
        {
          name: 'Unallocated',
          value: Math.max(0, round.budget - round.committed),
          colour: ALLOCATE_LEFT,
        },
      ]
    : []
  const roundPct =
    round && round.budget > 0 ? Math.round((round.committed / round.budget) * 100) : 0
  const roundLeft = round ? Math.max(0, round.budget - round.committed) : 0
  const roundDaysLeft = daysUntil(round?.closedAt)

  // KPI category breakdowns — one source for both the chips and the bar-meter, so the
  // strip's colours always match the legend beneath it.
  // Applications carries only the two ends of the pipeline it still owns — what has
  // yet to be looked at, and what is dead. Everything in between (shortlisted, and the
  // awarded that grew out of it) belongs to the Shortlist card, so the two cards read
  // as one pipeline rather than counting the same application twice.
  const appsCats: Chip[] = [
    { label: 'to review', count: d.pipeline.for_review, colour: KPI.apps.accent },
    { label: 'declined', count: d.pipeline.declined, colour: C.danger },
  ]
  // Approved is "the vote went its way", which stays true after the grant is minted —
  // so an awarded application is still an approved one, just further along.
  const approved = a.readyToAward.count + d.pipeline.awarded
  // Solid green first, its own 30% tint second — the strip darkens toward the decided
  // end, so the eye reads progress left to right.
  const reviewCats: Chip[] = [
    { label: 'approved', count: approved, colour: C.success },
    { label: 'to vote', count: d.awaitingVotes, colour: withAlpha(KPI.review.accent, 0.3) },
  ]
  // Reports stays inside its own pink family (Figma 126:33904) rather than reaching for
  // the global info/danger colours: on a strip of four cards the accent is what tells
  // you *which* card you are reading, so a blue chip on the pink card reads as a
  // different metric. Overdue is the deep rose end of the same family, not red.
  const reportsCats: Chip[] = [
    { label: 'to review', count: d.reportsToReview, colour: REPORTS_CHIP.toReview },
    { label: 'overdue', count: a.reportsOverdue.count, colour: REPORTS_CHIP.overdue },
  ]
  const toSegments = (cats: Chip[]): BarSegment[] =>
    cats.map((c) => ({ value: c.count, colour: c.colour }))
  const financeDenom = d.money.paidToDate + d.money.outstanding
  const financeProgress = financeDenom > 0 ? d.money.paidToDate / financeDenom : 0

  return (
    <div className="space-y-4">
      {/* Greeting — Figma: 20px medium, prefix grey (#97A1AF), name Gray/900 */}
      <h1 className="font-display text-heading font-medium">
        <span style={{ color: 'var(--color-grey-400)' }}>{greeting()}, </span>
        <span style={{ color: C.ink }}>{firstName(d.name)}</span>
      </h1>

      {/* KPI candy row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          tint={KPI.apps}
          value={String(d.pipeline.total)}
          sub={`+${d.submittedThisWeek} this week`}
          subColour={C.success}
          icon={AREA_ICON['/applications']!}
          label="Applications"
          meta={round?.roundName}
          to="/applications"
          search={{ roundId: undefined }}
          meter={<BarMeter segments={toSegments(appsCats)} colour={KPI.apps.accent} />}
        >
          <Chips chips={appsCats} />
        </KpiCard>

        <KpiCard
          tint={KPI.review}
          // The headline counts both chips, so the strip beneath it is the whole of
          // this number and not a fraction of it. `proposed` stays the shortlist's own
          // spend — an awarded grant is committed, not proposed.
          value={String(d.awaitingVotes + approved)}
          sub={`${fmtCompact(a.shortlist.proposed)} proposed`}
          icon={AREA_ICON['/shortlist']!}
          label="Shortlist"
          to="/shortlist"
          search={{ roundId: undefined }}
          meter={<BarMeter segments={toSegments(reviewCats)} colour={KPI.review.accent} />}
        >
          <Chips chips={reviewCats} />
        </KpiCard>

        <KpiCard
          tint={KPI.finance}
          value={fmtCompact(d.paymentsThisMonth.amount)}
          sub={`${d.paymentsThisMonth.count} payment${plural(d.paymentsThisMonth.count)}`}
          icon={AREA_ICON['/finance']!}
          label="Finance"
          to="/finance"
          meter={<BarMeter progress={financeProgress} colour={KPI.finance.accent} />}
        >
          <p className="mt-3 text-label" style={{ color: d.bankIssues > 0 ? C.danger : C.faint }}>
            {d.bankIssues > 0 ? `${d.bankIssues} bank-detail issue${plural(d.bankIssues)}` : null}
          </p>
        </KpiCard>

        <KpiCard
          tint={KPI.reports}
          value={String(d.reportsToReview + a.reportsOverdue.count)}
          // Only the count carries the accent; the word stays Gray/500 (Figma 126:34510).
          sub={
            a.reportsOverdue.count > 0 ? (
              <>
                <span style={{ color: REPORTS_CHIP.toReview }}>{a.reportsOverdue.count}</span>{' '}
                overdue
              </>
            ) : (
              'up to date'
            )
          }
          icon={AREA_ICON['/reports']!}
          label="Reports"
          to="/reports"
          meter={<BarMeter segments={toSegments(reportsCats)} colour={KPI.reports.accent} />}
        >
          <Chips chips={reportsCats} />
        </KpiCard>
      </div>

      {/* On your desk + Round */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelTitle>On your desk</PanelTitle>
          {desk.length === 0 ? (
            <div className="flex items-center gap-3 py-6 text-body" style={{ color: C.sub }}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/10 text-success">
                ✓
              </span>
              You’re all caught up — nothing needs action right now.
            </div>
          ) : (
            <div className="-mx-2 -mt-2">
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
                      className="rounded-full px-2.5 py-1 text-label font-medium"
                      style={{ backgroundColor: C.wash, color: C.sub }}
                    >
                      {roundDaysLeft > 0 ? `${roundDaysLeft} days left` : 'closed'}
                    </span>
                  )
                }
              >
                {round.roundName}
              </PanelTitle>
              <p className="-mt-2 mb-4 text-label" style={{ color: C.sub }}>
                {fmtCompact(round.committed)} committed of {fmtCompact(round.budget)} budget
              </p>
              <div className="flex items-center gap-6">
                <Donut
                  data={donutData}
                  center={
                    <>
                      <div className="text-heading font-semibold" style={{ color: C.ink }}>
                        {roundPct}%
                      </div>
                      <div
                        className="mt-0.5 text-center text-label leading-tight"
                        style={{ color: C.sub }}
                      >
                        {fmtCompact(roundLeft)} left
                        <br />
                        to allocate
                      </div>
                    </>
                  }
                />
                <div className="min-w-0 flex-1 space-y-3.5">
                  {round.programmes.length === 0 && (
                    <p className="text-body" style={{ color: C.faint }}>
                      No programmes in this round yet.
                    </p>
                  )}
                  {round.programmes.map((p, i) => (
                    <div key={p.name}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-label font-medium" style={{ color: C.ink }}>
                          {p.name}
                        </span>
                        <span className="shrink-0 text-label font-medium" style={{ color: C.sub }}>
                          {fmtCompact(p.committed)} / {fmtCompact(p.budget)}
                        </span>
                      </div>
                      {/* Figma 126:34735 — the track is the programme's own hue at 20%, not grey. */}
                      <ProgressBar
                        className="mt-2"
                        value={p.budget > 0 ? p.committed / p.budget : 0}
                        colour={PROG_COLOURS[i % PROG_COLOURS.length]!}
                        track={withAlpha(PROG_COLOURS[i % PROG_COLOURS.length]!, 0.2)}
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
              <p className="py-8 text-center text-body" style={{ color: C.faint }}>
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

        {/* The feed must not set the row height — a busy week would leave "Giving so far"
            stretched with dead space beneath the chart. Taking the panel out of flow leaves
            the cell sized by the chart alone, and the feed scrolls inside it. Below lg the
            two panels are stacked, so the panel goes back in flow and grows naturally. */}
        <div className="relative">
          <Panel className="flex flex-col lg:absolute lg:inset-0">
            <PanelTitle>Lately</PanelTitle>
            {d.lately.length === 0 ? (
              <p className="py-4 text-body" style={{ color: C.faint }}>
                No activity yet.
              </p>
            ) : (
              <div className="-mx-2 min-h-0 flex-1 space-y-1 overflow-y-auto px-2">
                {d.lately.map((ev) => {
                  const icon = LATELY_ICON[ev.action as FeedAction]
                  if (!icon) return null
                  const org = ev.organisationName ?? 'an application'
                  const inner = (
                    <>
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-chip"
                        style={{ backgroundColor: DESK_TILE }}
                      >
                        <HugeiconsIcon
                          icon={icon}
                          className="h-5 w-5"
                          strokeWidth={1.5}
                          style={{ color: C.sub }}
                        />
                      </span>
                      <span
                        className="min-w-0 flex-1 text-label font-medium leading-snug"
                        style={{ color: C.sub }}
                      >
                        <span style={{ color: C.ink }}>{ev.actorName ?? 'Someone'}</span>{' '}
                        {ACTION_VERB[ev.action as FeedAction]}{' '}
                        <span style={{ color: C.ink }}>{org}</span>
                      </span>
                      <span className="shrink-0 text-label font-medium" style={{ color: C.sub }}>
                        {relativeTime(ev.at)}
                      </span>
                    </>
                  )
                  return ev.applicationId ? (
                    <Link
                      key={ev.id}
                      to="/applications/$applicationId"
                      params={{ applicationId: ev.applicationId }}
                      className="flex items-center gap-3 rounded-chip px-2 py-2 transition-colors hover:bg-grey-50"
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
            {/* The panel is a reading of the log, not the whole of it (see
                `FEED_ACTIONS`). Without a way through, its deliberate incompleteness
                looks like the entire record — which is the impression an audit trail
                can least afford to give. Admin-only, as the screen behind it is. */}
            {isAdmin && (
              <Link
                to="/settings/activity"
                className="mt-3 shrink-0 text-label font-medium hover:underline"
                style={{ color: C.brand }}
              >
                See all activity
              </Link>
            )}
          </Panel>
        </div>
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
        <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
          Giving so far
        </h2>
        <div className="inline-flex rounded-chip p-0.5" style={{ backgroundColor: C.wash }}>
          {ranges.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="rounded-chip px-2.5 py-1 text-label font-medium transition-colors"
              style={
                range === r.key
                  ? {
                      backgroundColor: '#fff',
                      color: C.ink,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                    }
                  : { color: C.sub }
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-display font-semibold leading-none" style={{ color: C.ink }}>
          {fmtCompact(headline)}
        </span>
        {giving.quarter > 0 && (
          <span className="flex items-center gap-1 text-body font-medium">
            <span style={{ color: C.success }}>+{fmtCompact(giving.quarter)}</span>
            <span style={{ color: C.sub }}>this quarter</span>
          </span>
        )}
      </div>
      <p className="mt-1.5 text-label" style={{ color: C.sub }}>
        across {giving.grants} grant{plural(giving.grants)}
      </p>

      <div className="mt-4">
        {series.length > 0 ? (
          <GivingArea data={series} />
        ) : (
          <p className="py-10 text-center text-body" style={{ color: C.faint }}>
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
    {
      n: '1',
      title: 'Create a round',
      body: 'Set up a funding round and the programmes within it.',
      to: '/rounds',
      cta: 'Go to rounds',
    },
    {
      n: '2',
      title: 'Add programmes',
      body: 'Define programmes, budgets and grant limits.',
      to: '/programmes',
      cta: 'Go to programmes',
    },
    {
      n: '3',
      title: 'Connect intake',
      body: 'Generate an API key so applications can flow in.',
      to: '/settings/api-keys',
      cta: 'Go to API keys',
    },
  ] as const
  // The first screen a new foundation ever sees, so it is drawn in the same voice as the
  // dashboard it becomes — the same <h1>, the same cards, the same brand green. It used
  // to wear a heavier heading and `text-success` links, which made the app look like it
  // changed hands between the empty state and the full one.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
          {greeting()}, {firstName(name)}.
        </h1>
        <p className="font-display text-body" style={{ color: C.sub }}>
          Three things to set up, and applications can start arriving.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map((s) => (
          <UiCard key={s.n} className="flex flex-col p-4">
            <span
              className="flex size-7 items-center justify-center rounded-full font-display text-body font-medium"
              style={{ backgroundColor: C.brandBg, color: C.brand }}
            >
              {s.n}
            </span>
            <p className="mt-3 font-display text-title font-medium" style={{ color: C.ink }}>
              {s.title}
            </p>
            <p
              className="mt-1 flex-1 font-display text-body leading-relaxed"
              style={{ color: C.sub }}
            >
              {s.body}
            </p>
            <TextLink to={s.to} className="mt-3 text-label">
              {s.cta} →
            </TextLink>
          </UiCard>
        ))}
      </div>
    </div>
  )
}
