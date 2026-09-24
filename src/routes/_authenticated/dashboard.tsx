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
import { compactExact, fmtCompact } from '../../lib/format'
import { CompactMoney } from '../../components/ui'
import { resolveProgrammeColour } from '../../lib/programmeColours'
import { canSeePayments } from '../../lib/roles'
import { C, tint as T } from '../../components/ui/tokens'

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

// The donut and the programme bars take each programme's OWN colour
// (`resolveProgrammeColour`), so a programme reads the same here as on its card, its
// swatch and in Insights. This is the one segment that is not a programme.
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

type Chip = {
  label: string
  /** What decides whether the chip is shown, and (in the meters) how wide its segment
   *  is. On the money cards this is pounds, which is why `display` exists. */
  count: number
  colour: string
  /** Overrides the leading figure — `£8k` for a chip counting money rather than rows. */
  display?: React.ReactNode
  /**
   * Shown only if it fits on a line the legend already has — see `Chips`. For a chip
   * the reader can work out from the others (Finance's `later` is the headline less
   * the other two), never for one that carries news of its own.
   */
  droppable?: boolean
}

function Chips({ chips }: { chips: Chip[] }) {
  // Only categories that actually have something in them — "0 declined" is noise,
  // and it has to match the bar-meter, which drops empty segments too.
  //
  // A chip is USUALLY a segment of the meter above it, but not always: Finance appends
  // its bank-detail issues here, which are a count of grants and not a slice of the
  // outstanding pounds the bar is drawn from. It sits in the legend rather than on a
  // line of its own because a line only present when something is wrong pushes the whole
  // card taller on exactly the day it is worst read.
  //
  // A `droppable` chip is shown only when it fits, so a narrow card loses it rather than
  // growing a second line — and with it, since grid siblings share a height, making all
  // four cards taller. Done in CSS, not by measuring: the droppable chips sit in a box
  // that takes whatever is left of the current line (`flex-1`, basis 0) and is exactly
  // one line tall with its overflow hidden. A zero-width spacer occupies that box's first
  // line, so a chip too wide for the space left cannot sit beside it and wraps onto the
  // box's second line, which is clipped — all or nothing, never half a figure. `-ml-4`
  // cancels the row's gap (the box carries its own, before the chip) so the box can never
  // be the thing pushed onto a new line. When the legend already wraps for another reason
  // (bank issues), the box follows onto that line and the chip shows there for free.
  const shown = chips.filter((c) => c.count > 0)
  if (!shown.length) return null
  const kept = shown.filter((c) => !c.droppable)
  const droppable = shown.filter((c) => c.droppable)
  const chip = (c: Chip) => (
    <span key={c.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.colour }} />
      {c.display ?? c.count} {c.label}
    </span>
  )
  return (
    <div
      className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-label"
      style={{ color: C.sub }}
    >
      {kept.map(chip)}
      {droppable.length > 0 && (
        <span className="-ml-4 flex h-[1lh] min-w-0 flex-[1_1_0%] flex-wrap gap-x-4 overflow-hidden">
          <span aria-hidden className="h-[1lh] w-0" />
          {droppable.map(chip)}
        </span>
      )}
    </div>
  )
}

// ─── KPI card ───────────────────────────────────────────────────────────────────

/** "£4,840 proposed" for a card whose headline had to round, and nothing when it did not. */
function exactOr(amount: number, noun: string): string | undefined {
  const exact = compactExact(amount)
  return exact ? `${exact} ${noun}` : undefined
}

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
  title,
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
  /**
   * The exact figure behind a rounded one, as a phrase: "£4,840 due this month".
   *
   * The card is a `<Link>`, and a link may not contain interactive content — so the
   * focusable trigger `CompactMoney` puts around a rounded number everywhere else
   * cannot go inside one. A `title` on the anchor gives the same hover with no second
   * tab stop, which is the trade the facet chips on Applications already make.
   */
  title?: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      search={search}
      title={title}
      className="flex flex-col rounded-pill border bg-white p-1 transition-shadow hover:shadow-xs"
      style={{ borderColor: C.line }}
    >
      {/* Tinted inner panel (Figma 112:134) — inset 4px, holds the number/meter/chips.

          `grow`, because the four cards are grid siblings & therefore already all as
          tall as the tallest: without it each tint was only its own content's height and
          the slack fell BELOW the footer, so four cards with identical borders had their
          tinted blocks & their labels ending at four different heights.

          `grow` rather than `flex-1`: both align the row, but `flex-1` zeroes the basis,
          which leaves the tint free to be SHRUNK below its content — and it is the
          element carrying `overflow-hidden`, so that clips the meter rather than showing
          it. Keeping the basis auto means the slack can only ever be added.

          Content stays top-aligned, so the meters still line up across the row; it is
          only the slack that moves inside the tint. */}
      <div
        className="relative grow overflow-hidden rounded-card p-4"
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
      search: { roundId: round?.roundId, status: ['for_review'] },
    })
  // Only for roles that can open Finance. A trustee following this row would be
  // redirected straight back here — an item on your desk you cannot pick up is worse
  // than one that isn't listed.
  if (paymentsDue > 0 && canSeePayments(user.role))
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
      search: { roundId: round?.roundId },
    })
  if (a.readyToAward.count > 0)
    desk.push({
      lead: `${a.readyToAward.count} award${plural(a.readyToAward.count)}`,
      rest: 'ready to set up',
      to: '/shortlist',
      search: { roundId: round?.roundId },
    })
  if (d.reportsToReview > 0)
    desk.push({
      lead: `${d.reportsToReview} report${plural(d.reportsToReview)}`,
      rest: 'to review',
      to: '/reports',
    })

  // ── Round donut data (per-programme committed + an "unallocated" remainder) ──
  //
  // Over budget, the ring reads as a meter that has gone round once and kept going:
  // the full circle is the budget, and the overspend laps past the top in red, starting
  // at twelve o'clock and running clockwise, so a 135% round shows 35% of the ring in
  // red. The programmes share what is left of the circle in proportion to what each
  // committed. Drawn at their true values they filled the ring and the overspend was
  // invisible, a 135% round looking exactly like a 100% one. The tooltip still prints
  // each programme's real figure (`amount`), since the drawn share is not one. Past
  // 200% the red is the whole ring.
  const roundOver = round && round.budget > 0 ? Math.max(0, round.committed - round.budget) : 0
  const lapped = round ? Math.min(roundOver, round.budget) : 0
  const drawnShare = roundOver > 0 ? (round!.budget - lapped) / round!.committed : 1
  const donutData: DonutSlice[] = round
    ? [
        ...(roundOver > 0
          ? [{ name: 'Over budget', value: lapped, amount: roundOver, colour: C.danger }]
          : []),
        ...round.programmes.map((p, i) => ({
          name: p.name,
          value: p.committed * drawnShare,
          amount: p.committed,
          colour: resolveProgrammeColour(p.colour, i),
        })),
        ...(roundOver > 0
          ? []
          : [
              {
                name: 'Unallocated',
                value: Math.max(0, round.budget - round.committed),
                colour: ALLOCATE_LEFT,
              },
            ]),
      ]
    : []
  const roundPct =
    round && round.budget > 0 ? Math.round((round.committed / round.budget) * 100) : 0
  const roundLeft = round ? Math.max(0, round.budget - round.committed) : 0
  const roundDaysLeft = daysUntil(round?.closedAt)

  // KPI category breakdowns — one source for both the chips and the bar-meter, so the
  // strip's colours always match the legend beneath it.
  // Applications is the WHOLE of the focus round: every application in it, split by
  // where it has got to, so the headline is the round's size and the strip is all of
  // it. It used to carry only the two ends (to review, declined) and leave the middle to
  // Shortlist, which made a headline nobody could name: neither "applications in the
  // round" nor "applications left to do".
  // The FOCUS ROUND's applications, not the tenant's — this is the one card that names
  // a round in its footer, and a headline counting every round ever run under a footer
  // reading "Summer 2026" is two different questions in one card. Falls back to the
  // tenant-wide counts only when there is no round at all, where the two are the same
  // thing anyway (an application cannot exist without a round-programme).
  //
  // Three states, not four: "shortlisted" counts everything that MADE the shortlist,
  // awarded included, because the Shortlist card beside this one breaks that figure
  // down (to vote / ready to award / awarded) and the two must agree. Pale violet
  // waiting, solid violet shortlisted. Declined is a DARK grey: `danger` was
  // too strong (a decline is a decision made, not something wrong), and a pale grey or
  // pale violet read as the same thing as "to review" at chip size. NOT droppable,
  // unlike Finance's "later": a hidden state leaves the legend not summing to the
  // headline, so on a narrow card the legend wraps instead.
  const appsPipeline = round?.pipeline ?? d.pipeline
  const appsCats: Chip[] = [
    {
      label: 'to review',
      count: appsPipeline.for_review,
      colour: withAlpha(KPI.apps.accent, 0.3),
    },
    {
      label: 'shortlisted',
      count: appsPipeline.shortlisted + appsPipeline.awarded,
      colour: KPI.apps.accent,
    },
    {
      label: 'declined',
      count: appsPipeline.declined,
      colour: 'var(--color-grey-500)',
    },
  ]
  // The line under the headline says what the number IS, since "+0 this week" was what
  // it said most weeks. The week's arrivals are appended while there are any, because
  // that is news; a quiet week says nothing about it.
  const appsSub = (
    <>
      {round ? 'Applications in this round' : 'Applications across all rounds'}
      {d.submittedThisWeek > 0 && (
        <>
          {' · '}
          <span style={{ color: C.success }}>+{d.submittedThisWeek} this week</span>
        </>
      )}
    </>
  )
  // The active round's shortlist (the server scopes it) plus what it has become: to
  // vote, ready to award, awarded. Together they are Applications' "shortlisted" for
  // the same round. Carried "approved = ready + every grant EVER awarded" until
  // 2026-09-24, so the headline only ever grew and could not be squared with the card
  // next door.
  //
  // `awardedByDecision`, NOT `awarded`: a grant carried in by the onboarding data
  // import is at `awarded` without ever having been shortlisted or voted on, and an
  // import-created round can be the focus round for a foundation that has not run one
  // in Custodian yet. It is recording a fact, not a decision.
  //
  // Pale, mid, solid green: the strip darkens toward the decided end, and awarded (the
  // decision actually made) is the strongest.
  const roundAwarded = (round?.pipeline ?? d.pipeline).awardedByDecision
  const reviewCats: Chip[] = [
    { label: 'to vote', count: d.awaitingVotes, colour: withAlpha(KPI.review.accent, 0.3) },
    {
      label: 'ready to award',
      count: a.readyToAward.count,
      colour: withAlpha(KPI.review.accent, 0.6),
    },
    { label: 'awarded', count: roundAwarded, colour: C.success },
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
  // Finance's strip is the OUTSTANDING book — the money promised and not yet gone —
  // split into the three horizons a payment run is planned over, which are the same
  // three the Finance screen itself prints (`HORIZONS`, finance.index.tsx). It replaced
  // `paidToDate / (paidToDate + outstanding)`, a lifetime ratio that moved a percent or
  // two a year and carried no legend, so the one card in the row whose bar you could
  // not read was also the one whose bar never moved.
  //
  // THREE segments rather than the obvious two (overdue / everything else), because
  // "nothing overdue" is the normal state and has to look like something. Split in two,
  // a healthy book draws one flat block with a single chip under it — and a foundation
  // paying quarterly is in that state most weeks of the year. Split by horizon, the bar
  // still has a near end and a far end when nothing is wrong, and it visibly moves as
  // instalments cross into the month and get paid.
  //
  // The three are subsets of `money.outstanding` and cannot overlap (an instalment
  // dated earlier this month and unpaid is overdue, not "this month" — see the server
  // fn), so `later` is the remainder: everything beyond this month, plus the undated
  // "TBC" instalments, which is where they belong — still owed, just not yet dated.
  // All of it obeys the money rule, since `money.outstanding` excludes cancelled grants.
  //
  // Left to right it goes red, solid, pale — the eye lands on the urgent end. Overdue
  // takes the semantic hue while the card's own amber says "routine" (see the KPI tints
  // above), exactly as Reports does with its overdue chip. `later` is deliberately
  // lighter-but-substantial rather than Shortlist's 30% tint: there the pale segment is
  // a minority state, here it is often the WHOLE bar, and a bar made entirely of a
  // track colour reads as an empty meter rather than a full book.
  const financeOverdue = a.paymentsOverdue.amount
  const financeThisMonth = d.paymentsThisMonth.amount
  const financeLater = Math.max(0, d.money.outstanding - financeOverdue - financeThisMonth)
  const financeCats: Chip[] = [
    {
      label: 'overdue',
      count: financeOverdue,
      colour: C.danger,
      display: fmtCompact(financeOverdue),
    },
    {
      label: 'this month',
      count: financeThisMonth,
      colour: KPI.finance.accent,
      display: fmtCompact(financeThisMonth),
    },
    {
      label: 'later',
      count: financeLater,
      colour: withAlpha(KPI.finance.accent, 0.4),
      display: fmtCompact(financeLater),
      // The headline less the other two, so a narrow card can lose it (see `Chips`); the
      // pale segment stays in the bar, and the figure stays in the card's `title`.
      droppable: true,
    },
  ]
  // Legend only — bank issues are grants, not pounds, so they never reach `toSegments`.
  // Placed BEFORE `later`, because droppable chips go last: a bank-detail problem is
  // news and is never the chip a narrow card gives up.
  const financeChips: Chip[] = [
    ...financeCats.filter((c) => !c.droppable),
    ...(d.bankIssues > 0
      ? [
          {
            label: `bank-detail issue${plural(d.bankIssues)}`,
            count: d.bankIssues,
            colour: C.danger,
          },
        ]
      : []),
    ...financeCats.filter((c) => c.droppable),
  ]

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
          // Every application in the round: the strip beneath is all four states, so
          // it is the whole of this number (see `appsCats`).
          value={String(appsPipeline.total)}
          sub={appsSub}
          icon={AREA_ICON['/applications']!}
          label="Applications"
          meta={round?.roundName}
          to="/applications"
          // The round the card counted, not whichever one the list would pick for
          // itself: /applications defaults to the most recent NON-UPCOMING round, the
          // dashboard focuses the open one, and the two disagree the moment a round is
          // scheduled ahead. A card that says 22 must open onto those 22.
          search={{ roundId: round?.roundId }}
          meter={<BarMeter segments={toSegments(appsCats)} colour={KPI.apps.accent} />}
        >
          <Chips chips={appsCats} />
        </KpiCard>

        <KpiCard
          tint={KPI.review}
          // Every chip, so the strip beneath is the whole of this number. It equals
          // Applications' "shortlisted" (bar imported grants, see `roundAwarded`).
          value={String(a.shortlist.count + roundAwarded)}
          sub={`${fmtCompact(a.shortlist.proposed)} proposed`}
          title={exactOr(a.shortlist.proposed, 'proposed')}
          icon={AREA_ICON['/shortlist']!}
          label="Shortlist"
          meta={round?.roundName}
          to="/shortlist"
          search={{ roundId: round?.roundId }}
          meter={<BarMeter segments={toSegments(reviewCats)} colour={KPI.review.accent} />}
        >
          <Chips chips={reviewCats} />
        </KpiCard>

        {/* Same rule as the desk row: the card links into Finance, so it is only
            shown to the roles that may go there. */}
        {canSeePayments(user.role) && (
          <KpiCard
            tint={KPI.finance}
            // The headline is the sum of the two money chips, the same bargain the
            // other three cards make — the strip beneath is the whole of this number
            // and not a fraction of it. It is also the figure Finance prints as
            // "To pay", so the two screens reconcile (the 2026-08-27 money audit).
            value={fmtCompact(d.money.outstanding)}
            // Both figures on the card can round, and a Link may hold only one title —
            // so it carries whichever of them actually lost something. Plus `later`
            // whenever there is any, since a narrow card drops that chip and this is
            // then the one place left to read it.
            title={
              [
                exactOr(d.money.outstanding, 'to pay'),
                exactOr(d.money.paidToDate, 'paid to date'),
                financeLater > 0
                  ? `${compactExact(financeLater) ?? fmtCompact(financeLater)} later`
                  : undefined,
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
            // The other half of the book, and the one figure the dashboard shows
            // nowhere else: "Giving so far" below counts what was AWARDED, which is a
            // commitment, not money that moved. It is also the number the old progress
            // bar was reaching for, now said in words instead of an unlabelled ratio.
            // Per the money rule, paid-to-date deliberately includes cancelled grants.
            sub={`${fmtCompact(d.money.paidToDate)} paid to date`}
            icon={AREA_ICON['/finance']!}
            label="Finance"
            to="/finance"
            meter={<BarMeter segments={toSegments(financeCats)} colour={KPI.finance.accent} />}
          >
            <Chips chips={financeChips} />
          </KpiCard>
        )}

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
        {/* Same treatment as "Lately" below: the queue must not set the row height, or a
            busy desk leaves the round panel stretched with dead space under the donut.
            Out of flow, the cell is sized by the round panel and the desk scrolls inside
            it — with a floor so a tenant between rounds (a two-line panel) still gets a
            readable list. Below lg the two are stacked, so it goes back in flow. */}
        <div className="relative lg:min-h-[13rem]">
          <Panel className="flex flex-col lg:absolute lg:inset-0">
            <PanelTitle>On your desk</PanelTitle>
            {desk.length === 0 ? (
              <div className="flex items-center gap-3 py-6 text-body" style={{ color: C.sub }}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/10 text-success">
                  ✓
                </span>
                You’re all caught up. Nothing needs action right now.
              </div>
            ) : (
              <div className="-mx-2 -mt-2 min-h-0 flex-1 overflow-y-auto">
                {desk.map((row, i) => (
                  <DeskRow key={i} {...row} />
                ))}
              </div>
            )}
          </Panel>
        </div>

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
                <CompactMoney amount={round.committed} label="Exact committed" /> committed of{' '}
                <CompactMoney amount={round.budget} label="Exact round budget" /> budget
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
                        {roundOver > 0 ? (
                          <>
                            <span style={{ color: C.danger }}>
                              <CompactMoney amount={roundOver} label="Exact amount over budget" />{' '}
                              over
                            </span>
                            <br />
                            budget
                          </>
                        ) : (
                          <>
                            <CompactMoney
                              amount={roundLeft}
                              label="Exact amount left to allocate"
                            />{' '}
                            left
                            <br />
                            to allocate
                          </>
                        )}
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
                          <CompactMoney amount={p.committed} label={`Exact committed, ${p.name}`} />{' '}
                          / <CompactMoney amount={p.budget} label={`Exact budget, ${p.name}`} />
                        </span>
                      </div>
                      {/* Figma 126:34735 — the track is the programme's own hue at 20%, not grey. */}
                      <ProgressBar
                        className="mt-2"
                        value={p.budget > 0 ? p.committed / p.budget : 0}
                        colour={resolveProgrammeColour(p.colour, i)}
                        track={withAlpha(resolveProgrammeColour(p.colour, i), 0.2)}
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
          <CompactMoney amount={headline} label="Exact giving in this period" />
        </span>
        {giving.quarter > 0 && (
          <span className="flex items-center gap-1 text-body font-medium">
            <span style={{ color: C.success }}>
              +<CompactMoney amount={giving.quarter} label="Exact giving this quarter" />
            </span>
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
