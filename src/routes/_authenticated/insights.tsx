import { Fragment, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
// Shared with the Awards register: this screen links INTO it on the region, and a
// sentinel spelled differently at the two ends is a link that silently filters nothing.
import { NO_REGION } from '../../lib/deprivation/types'
import { matchesAnyFilter, matchesFilter, summariseSelection } from '../../lib/filterSelection'
import { textList } from '../../lib/listSearch'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Coins01Icon,
  EarthIcon,
  Location01Icon,
  ChartAverageIcon,
  ArrowRight01Icon,
  InformationCircleIcon,
  SparklesIcon,
} from '@hugeicons/core-free-icons'
import {
  CompactMoney,
  DateRangePicker,
  EmptyState,
  ExportButton,
  FilterPill,
  KPI_TINTS,
  MiniKpi,
  Tooltip,
  TruncatedList,
  TruncatedText,
  formatDateRange,
  useReveal,
} from '../../components/ui'
import { Donut, type DonutSlice } from '../../components/charts/Donut'
import { GivingArea, type GivingPoint } from '../../components/charts/GivingArea'
import {
  Choropleth,
  MapAttribution,
  UK_ISO3,
  drillTarget,
  useAreaNames,
  useCounties,
  type MapView,
} from '../../components/charts/Choropleth'
import { DotGrid } from '../../components/charts/DotGrid'
import { BarMeter, withAlpha } from '../../components/BarMeter'
import { getInsights, getPortfolioSummary, type InsightsGrant } from '../../server/fns/insights'
import {
  decileShare,
  effImpact,
  fundingByDecile,
  impactByUnit,
  type ImpactSource,
  type UnitTotal,
} from '../../lib/insights/aggregate'
import { exportInsightsPdf } from '../../lib/exportInsightsPdf'
import { fmtCompact, fmtDateTime, fmtMoney } from '../../lib/format'
import { impactPhrase } from '../../lib/impactUnits'
import { colourSeries, resolveProgrammeColour } from '../../lib/programmeColours'
import { C, bandForDecile } from '../../components/ui/tokens'

// Insights: portfolio analysis over every awarded grant. Everything on this
// screen is computed — from grant amounts, resolved deprivation deciles, and the
// impact figures the report-analysis pipeline has already extracted and stored.
// No screen-time AI: where a number's coverage is partial the denominator is stated.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

type InsightsSearch = {
  /** Inclusive decision-date window (`yyyy-mm-dd`); absent = all time. */
  from?: string
  to?: string
  // Each pill takes several values, OR'd within one — see `lib/filterSelection`.
  programmeId?: string[]
  tag?: string[]
  /** Delivery regions, `NO_REGION` among them — the same strings the register takes. */
  region?: string[]
}

export const Route = createFileRoute('/_authenticated/insights')({
  validateSearch: (search: Record<string, unknown>): InsightsSearch => ({
    from: typeof search.from === 'string' && ISO_DAY.test(search.from) ? search.from : undefined,
    to: typeof search.to === 'string' && ISO_DAY.test(search.to) ? search.to : undefined,
    programmeId: textList(search.programmeId),
    tag: textList(search.tag),
    region: textList(search.region),
  }),
  loader: async () => {
    // Two independent reads, in parallel. The summary is one row written hours ago by
    // the dispatcher, so it can never be the thing that makes this screen slow.
    const [insights, portfolio] = await Promise.all([getInsights(), getPortfolioSummary()])
    return { ...insights, portfolio }
  },
  component: InsightsPage,
})

// ─── Design tokens ───────────────────────────────────────────────────────────────
// The KPI row's tints are `KPI_TINTS`, in row order. This screen kept its own copy after
// the dashboard moved to the accents, so Deprivation reach and Average grant were drawn
// in `warning` and `danger` at 10% — tan and grey-pink beside the dashboard's cream and
// blush, and a colour that read as a verdict on two figures that are neither.
const KPI = {
  committed: KPI_TINTS.violet,
  people: KPI_TINTS.green,
  reach: KPI_TINTS.amber,
  avg: KPI_TINTS.pink,
}
/**
 * How many areas the map's ranked list names before the tail is pooled into "other".
 * It used to be `PALETTE.length` — the count of an unrelated five-colour list, so
 * adding a colour to that list would have silently changed what this panel shows.
 */
const MAX_AREAS = 5
/**
 * The donut and list row for money that covers the WHOLE area in view — a grant
 * delivered "across Merseyside" in the county view, or "across the North West" in the
 * region view. Not an area key the map has, so no area lights up for it; the map
 * outlines the whole view instead (`outlineAll`).
 */
const WIDE_KEY = '__wide__'
/** Neutral: it is not a place on the map, so it must not look like one of the hues
 *  that are. Darker than the "Other areas" tail, which is `C.line`. */
const WIDE_COLOUR = 'var(--color-grey-400)'

/** "the North West", "the East of England", but "London", "Wales", "Yorkshire and The
 *  Humber" — the compass-point regions take an article in a sentence. */
function regionInProse(region: string) {
  return /^(North|South|East|West)\b/.test(region) ? `the ${region}` : region
}

// ─── Formatting ──────────────────────────────────────────────────────────────────

// Count-up for the headline stats (SSR-safe; sits still under reduced motion).
function useCountUp(target: number, duration = 450): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - t) ** 3
      const next = from + (target - from) * eased
      setValue(next)
      fromRef.current = next
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

// ─── Primitives ──────────────────────────────────────────────────────────────────

function Panel({
  children,
  className = '',
  innerRef,
  ...rest
}: {
  children: React.ReactNode
  className?: string
  innerRef?: React.Ref<HTMLDivElement>
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      ref={innerRef}
      className={`rounded-card border bg-white p-4 ${className}`}
      style={{ borderColor: C.line }}
      {...rest}
    >
      {children}
    </div>
  )
}

function PanelTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-4 flex min-h-8 items-center justify-between gap-3">
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

/**
 * A grant count, as a way into the Awards register showing exactly those grants.
 *
 * A count of grants is already a pointer to them, so it is the link rather than some
 * separate "view all" bolted beside it. It carries the slice being read — the date
 * window, programme, theme and region pills — plus whatever this particular count
 * narrowed further.
 *
 * It carries NO status. Insights excludes cancelled grants from every figure it prints
 * (the money rule) and the register lists them, because there the cancellation is part of
 * the record — so a region holding a cancelled grant opens one row longer than the count
 * clicked. That row is greyed and pilled "Cancelled", which is a better explanation than
 * a filter silently hiding it, and it is why this does not reach for one.
 *
 * Brand-coloured rather than inheriting the line it sits in. These counts live inside
 * dense grey sublines beside money and impact figures, and an underline-on-hover alone
 * gave no sign the text was reachable until the pointer was already on it.
 *
 * The one place it is NOT used is a count already wrapped in a link of its own — the
 * round-programme card, which is itself a way into the register for that round and
 * programme (see `RoundProgrammeCard`). Everywhere else the count is the link, including inside truncating sublines (pulled out of the string, see
 * `themeRest`) and inside the map's drill rows (a sibling of the drill button, not a
 * child of it — see `AreaList`).
 */
/** The extra narrowing a particular count carries, on top of the slice being read. */
type GrantNarrow = {
  roundId?: string[]
  programmeId?: string[]
  tag?: string[]
  region?: string[]
}

function GrantCount({
  n,
  slice,
  narrow,
}: {
  n: number
  slice: InsightsSearch
  narrow?: GrantNarrow
}) {
  return (
    <Link
      to="/awards"
      search={{
        from: slice.from,
        to: slice.to,
        programmeId: slice.programmeId,
        tag: slice.tag,
        region: slice.region,
        ...narrow,
      }}
      className="font-medium underline decoration-transparent underline-offset-2 transition-colors hover:decoration-inherit"
      style={{ color: C.brand }}
    >
      {n} grant{n !== 1 ? 's' : ''}
    </Link>
  )
}

/**
 * A theme tile's second line: how many grants, what they came to, and the impact —
 * one total per unit, because a theme spans programmes and programmes measure in
 * different things.
 */
function themeRest(t: { amount: number; impact: UnitTotal[] }): string {
  return [fmtCompact(t.amount), ...t.impact.map(unitPhrase)].join(' · ')
}

/** A programme column's second line, minus its count. */
function programmeRest(p: { impact: UnitTotal[] }): string {
  return p.impact.map(unitPhrase).join(' · ')
}

/**
 * A count, then the rest of the line — the shape both sublines now take.
 *
 * The count used to be the head of one joined string inside a `TruncatedText`, which
 * could not be a link: that component measures its own span against its box to decide
 * whether to show a tooltip, and a child element inside the measured text breaks the
 * comparison. So the count is lifted OUT and the remainder keeps the truncation it was
 * given — the count is `shrink-0` because it is the one part of the line that must never
 * be the thing that clips, and the remainder takes what is left.
 */
function CountLine({
  count,
  rest,
  slice,
  narrow,
  className,
}: {
  count: number
  rest: string
  slice: InsightsSearch
  narrow?: GrantNarrow
  className?: string
}) {
  return (
    // The container carries the subline's grey; `GrantCount` sets its own brand colour
    // over it, so the link stands out of the line rather than recolouring the whole of it.
    <div
      className={`flex min-w-0 items-baseline gap-1 ${className ?? ''}`}
      style={{ color: C.sub }}
    >
      <span className="shrink-0">
        <GrantCount n={count} slice={slice} narrow={narrow} />
      </span>
      {rest && (
        <>
          <span className="shrink-0">·</span>
          <TruncatedText text={rest} label="Grants and impact" className="min-w-0 flex-1" />
        </>
      )}
    </div>
  )
}

/** The three bands the chart's legend names, each by a decile inside it. */
const DECILE_LEGEND = [
  { decile: 1, label: '1–3 most deprived' },
  { decile: 4, label: '4–7' },
  { decile: 8, label: '8–10 least deprived' },
] as const

// Column chart of funding across IMD deciles 1–10, banded 3-4-3 in the app's RAG fills
// (`bandForDecile`): 1–3 red, 4–7 amber, 8–10 green. It used to be two flat colours —
// the brand for 1–4, a wash for the rest — which said "in the most deprived 40% or not"
// and threw away the ordering the deciles ARE: decile 1 looked exactly like decile 4,
// and 5 exactly like 10. Red is the most deprived tenth, so a portfolio leaning red is
// the intended outcome; the legend says so rather than leaving the colour to argue it.
function DecileChart({
  amounts,
  total,
  max,
  play = false,
}: {
  amounts: number[]
  total: number
  max: number
  /** Grow the columns in — set once the panel has been scrolled to. */
  play?: boolean
}) {
  return (
    <div>
      <div className="relative mt-2 h-40">
        <DotGrid />
        <div className="relative flex h-full items-end gap-2">
          {amounts.map((amt, i) => {
            const pct = total > 0 ? Math.round((amt / total) * 100) : 0
            const h = Math.round((amt / max) * 100)
            return (
              // The money behind a column is nowhere else on the screen — only the
              // percentage is, and only above the taller ones — so the column has to
              // hand it over. `Tooltip` rather than a `title` because a bar a keyboard
              // user cannot reach is a bar whose value they never learn.
              <Tooltip
                key={i}
                label={`Decile ${i + 1}`}
                className="flex h-full flex-1"
                triggerClassName="group flex h-full w-full flex-col justify-end rounded-chip focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
                trigger={
                  <>
                    {amt > 0 && pct >= 4 && (
                      <span
                        className="mb-1 text-center font-display text-label"
                        style={{ color: C.faint }}
                      >
                        {pct}%
                      </span>
                    )}
                    <div
                      className={`mx-auto w-full max-w-[26px] rounded-t-chip ${play ? 'tick' : ''}`}
                      style={{
                        height: `${Math.max(amt > 0 ? 3 : 0, h)}%`,
                        backgroundColor: bandForDecile(i + 1).fill,
                        // Staggered most-deprived first, which is the direction the
                        // legend and the caption read in.
                        animationDelay: play ? `${i * 45}ms` : undefined,
                      }}
                    />
                  </>
                }
              >
                Decile {i + 1} · {fmtMoney(amt)} · {pct}%
              </Tooltip>
            )
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-2">
        {amounts.map((_, i) => (
          <span
            key={i}
            className="flex-1 text-center font-display text-label"
            style={{ color: C.sub }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {/* Three bands, worded so the colours cannot be misread as a verdict on the
          foundation: the ends are named ("most deprived" / "least deprived") and the
          middle is left as its numbers. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {DECILE_LEGEND.map((band) => (
          <span
            key={band.label}
            className="flex items-center gap-1.5 font-display text-label"
            style={{ color: C.sub }}
          >
            <span
              className="size-2 rounded-swatch"
              style={{ backgroundColor: bandForDecile(band.decile).fill }}
            />
            {band.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Derivations (pure, over the filtered grant set) ─────────────────────────────

// The ranked area list beside the map (Figma 434:37506).
//
// It earns its space by doing three jobs the map cannot. It *ranks* — a
// choropleth can't, because the quantile buckets deliberately compress a skewed
// distribution, so two regions an order of magnitude apart can share a colour.
// It is the donut's legend, carrying the same palette swatch, without which the
// ring beside it is an unreadable set of anonymous arcs. And it is the click
// target for areas too small to hit on the map — at world level that is most of
// them, and at district level it is every inner-London borough.
//
// Rows behave exactly like the map: one click selects *and* drills where a
// level exists beneath. Two different rules for the same act, on the same
// panel, would be the worse outcome.
function AreaList({
  areas,
  total,
  rest,
  selected,
  drillOf,
  onPick,
  highlight,
  onHighlight,
  slice,
  narrowOf,
}: {
  areas: Array<{ code: string; name: string; amount: number; count: number; colour: string }>
  total: number
  /** The tail the donut folds into one neutral arc; 0 to omit. Carried here
   *  because that arc is otherwise an unlabelled grey wedge. */
  rest: number
  selected: string | null
  /** The tier this row opens, or null if it is a leaf. Per row rather than per
   *  tier, because on the world map the UK drills and its neighbours only
   *  zoom — so the chevron has to be earned row by row. */
  drillOf: (code: string, name: string, funded: boolean) => MapView | null
  onPick: (code: string, name: string, to: MapView | null) => void
  /** Area held at full strength while the rest recede. */
  highlight: string | null
  onHighlight: (code: string | null) => void
  /** The slice being read, carried into whatever register a count opens. */
  slice: InsightsSearch
  /**
   * How the register should be narrowed to this row's area, or null if it cannot be.
   *
   * Per row, like `drillOf`, and for the same reason. At the UK tier a row IS a region,
   * which is exactly what the register groups on. One tier down a row is a DISTRICT, and
   * the register has no district filter — a link there would have to widen silently to
   * the parent region and hand back a longer list than the count it was attached to. So
   * those counts stay text, and the panel's own link beneath the list is the way out at
   * the granularity the register can actually honour.
   */
  narrowOf: (code: string, name: string) => GrantNarrow | null
}) {
  return (
    <ul className="flex flex-col gap-0.5" onMouseLeave={() => onHighlight(null)}>
      {areas.map((a) => {
        const on = selected === a.code
        const pct = total > 0 ? Math.round((a.amount / total) * 100) : 0
        const dim = highlight !== null && highlight !== a.code
        const to = drillOf(a.code, a.name, a.amount > 0)
        const countNarrow = narrowOf(a.code, a.name)
        return (
          // The row holds TWO targets, so the styling that used to sit on the button
          // moves out here and the button goes transparent: the drill (swatch, name,
          // chevron) and the count, which links to those grants in the register. A link
          // nested inside the button would be invalid and would fight it for the click.
          //
          // Hover and selection are driven from the `li` for the same reason — entering
          // either half should light the whole row, as it did when the row was one
          // control.
          <li
            key={a.code}
            onMouseEnter={() => onHighlight(a.code)}
            className="flex items-center gap-2.5 rounded-chip border px-2.5 py-1.5"
            style={{
              borderColor: on ? C.brand : 'transparent',
              backgroundColor: on ? '#fff' : highlight === a.code ? C.wash : undefined,
              opacity: dim ? 0.6 : 1,
              transition: 'opacity 200ms ease, background-color 150ms ease',
            }}
          >
            <button
              type="button"
              onClick={() => onPick(a.code, a.name, to)}
              onFocus={() => onHighlight(a.code)}
              onBlur={() => onHighlight(null)}
              aria-current={on || undefined}
              title={`${a.name} · ${fmtMoney(a.amount)} · ${pct}%`}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <span
                className="size-2.5 shrink-0 rounded-swatch"
                style={{ backgroundColor: a.colour }}
              />
              <span
                className="min-w-0 flex-1 truncate font-display text-body"
                style={{ color: C.ink }}
              >
                {a.name}
              </span>
            </button>

            {/* Count first and with its noun, then the money. This read "£45k · 1",
                where the 1 was the only figure on the panel whose unit lived in a
                tooltip — beside a money figure it scanned as a second, smaller
                amount. */}
            <span
              className="shrink-0 font-display text-label tabular-nums"
              style={{ color: C.sub }}
            >
              {countNarrow ? (
                <GrantCount n={a.count} slice={slice} narrow={countNarrow} />
              ) : (
                <>
                  {a.count} grant{a.count !== 1 ? 's' : ''}
                </>
              )}{' '}
              · {fmtCompact(a.amount)}
            </span>

            {to && (
              <button
                type="button"
                onClick={() => onPick(a.code, a.name, to)}
                aria-label={`Open ${a.name}`}
                className="shrink-0"
              >
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} color={on ? C.brand : C.faint} />
              </button>
            )}
          </li>
        )
      })}

      {rest > 0 && (
        <li className="flex items-center gap-2.5 px-2.5 py-1.5">
          <span className="size-2.5 shrink-0 rounded-swatch" style={{ backgroundColor: C.line }} />
          <span className="min-w-0 flex-1 truncate font-display text-body" style={{ color: C.sub }}>
            Other areas
          </span>
          <span
            className="shrink-0 font-display text-label tabular-nums"
            style={{ color: C.faint }}
          >
            <CompactMoney amount={rest} label="Exact total for the rest" />
          </span>
        </li>
      )}
    </ul>
  )
}

// Deprivation reach for whatever the map is currently showing.
//
// Scoped to the view rather than the portfolio on purpose: the decile panel
// further down already reports the portfolio-wide picture, so repeating that
// number here would spend a line without adding a fact. Scoped, it answers the
// question the map just raised — you drilled into a region, so how deprived is
// *there*?
//
// UK-only, and not by omission: IMD is a UK index with no meaning in Ukraine or
// Kenya, and deciles are per-nation, which is why the wording says "in its
// nation" rather than implying one UK-wide ranking.
function ImdNote({ pct }: { pct: number }) {
  return (
    <div
      className="flex items-start gap-2 rounded-control px-3 py-2.5"
      style={{ backgroundColor: C.wash }}
    >
      <HugeiconsIcon
        icon={InformationCircleIcon}
        size={16}
        color={C.sub}
        className="mt-px shrink-0"
      />
      <p className="font-display text-label leading-snug" style={{ color: C.sub }}>
        <span style={{ color: C.ink, fontWeight: 500 }}>{pct}%</span> of mapped funding reaches IMD
        deciles 1–2, the most deprived fifth of areas in its nation.
      </p>
    </div>
  )
}

// `decileShare`, `effImpact`, `impactByUnit` and `fundingByDecile` moved to
// src/lib/insights/aggregate.ts — the AI portfolio summary printed at the top of
// this screen quotes the same figures the charts below it draw, and two copies of
// that arithmetic is a banner that eventually contradicts its own page.

/**
 * `a, b and c` — the shape `describeOneOfGroup` uses, spelled out and with no serial
 * comma. For a list inside a sentence somebody reads; a table cell stays a `, ` join.
 */
function andList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** `1,200 people`, `31,000 items delivered (incl. proposed)`. */
function unitPhrase(t: UnitTotal): string {
  return `${impactPhrase(t.value, t.label)}${t.hasProposed ? ' (incl. proposed)' : ''}`
}

type RoundProgramme = {
  /** `null` for grants whose round-programme pairing no longer resolves. */
  id: string | null
  name: string
  grants: number
  total: number
  /** Impact in this programme's own unit — empty when no grant has stated a figure.
   *  A list because it comes from the one helper every impact figure on this screen
   *  goes through; a programme has one unit, so it holds at most one total. */
  impact: UnitTotal[]
}

/**
 * A round's grants folded into the programmes that funded them. Impact is summed
 * per programme rather than per round: a round's programmes each measure in their
 * OWN unit ("people", "meals", "hours"), so a round-level total would be adding
 * quantities that don't share a scale — inside one programme they do.
 */
function roundProgrammes(grants: InsightsGrant[]): RoundProgramme[] {
  return [...new Set(grants.map((g) => g.programmeId))]
    .map((pid) => {
      const own = grants.filter((g) => g.programmeId === pid)
      return {
        id: pid,
        name: own[0]!.programmeName ?? '--',
        grants: own.length,
        total: own.reduce((s, g) => s + g.amountAwarded, 0),
        impact: impactByUnit(own),
      }
    })
    .sort((a, b) => b.total - a.total)
}

/** How many themes the panel lists before offering the rest behind a toggle. */
const THEMES_SHOWN = 3

/** The programmes a theme's grants came from — all of them, in the order they were
 *  first seen. Clipping is `TruncatedText`'s job, and only at widths that need it. */
function programmeNames(names: string[]): string[] {
  return [...new Set(names)]
}

// ─── The AI portfolio summary ────────────────────────────────────────────────
//
// One paragraph measuring the portfolio against the foundation's own giving
// strategy, generated off-screen every three hours (`src/server/portfolioAnalysis`).
// Nothing here waits on anything: it is a row that already exists, or it is absent.
//
// It sits UNDER the deprivation-decile chart, near the foot of the stack: a reader
// arrives at Insights for the figures, and a paragraph of prose above the KPI cards
// pushed them below the fold on every visit. Read last it is a closing note on the
// charts above it rather than a preamble to them — and it is inside the capture root,
// so it now goes into the exported PDF, which is where the prose is most use.
//
// It is still BELOW the filter row while describing the WHOLE portfolio, which is the
// one deliberate exception to this app's rule that a control narrows what is under it
// and nothing over it — so the caption says "across all grants" whenever a filter is
// set. Without that label a reader with a programme selected would take the paragraph
// to be about that programme.
//
// Dark, because the design makes it the one inverted surface on a pale screen: it is
// prose among charts and has to read as a different KIND of thing, not as another
// panel. Both colours are mixed from the brand token rather than picked, so a change
// to the palette carries.
function PortfolioSummary({
  summary,
  hasStrategy,
  hasGrants,
  filtered,
}: {
  summary: { summary: string; generatedAt: string } | null
  hasStrategy: boolean
  hasGrants: boolean
  filtered: boolean
}) {
  // The two reasons there is no paragraph are not the same reason, and the reader can
  // only act on one of them. Without a strategy there is no yardstick to measure
  // against, so that is said first even on a portfolio with no grants yet.
  const waiting = !hasStrategy ? (
    <>
      Set your{' '}
      <Link
        to="/settings/giving-strategy"
        style={{ color: 'inherit', textDecoration: 'underline' }}
      >
        giving strategy
      </Link>{' '}
      and this becomes a read on how your grants measure against it.
    </>
  ) : !hasGrants ? (
    'Your portfolio summary appears here once you have made your first awards.'
  ) : (
    'Your portfolio summary is being prepared and will appear here shortly.'
  )

  return (
    <div
      data-export-block
      className="flex gap-3 rounded-card p-4"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-brand) 12%, var(--color-grey-900))',
      }}
    >
      <HugeiconsIcon
        icon={SparklesIcon}
        size={18}
        color="color-mix(in srgb, var(--color-brand) 55%, white)"
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0">
        <p
          className="font-display text-label font-medium"
          style={{ color: 'color-mix(in srgb, var(--color-brand) 55%, white)' }}
        >
          Portfolio summary
          {summary && filtered && <span style={{ color: C.faint }}> · across all grants</span>}
        </p>
        {/* The one paragraph that opts out of the 800px measure (globals.css). It is
            a full-width panel at the foot of the charts, so the text runs the
            panel's width. Deliberate; do not extend this to other prose. */}
        <p
          className="mt-1 max-w-none font-display text-body leading-relaxed"
          style={{ color: C.muted }}
        >
          {summary ? summary.summary : waiting}
        </p>
        {summary && (
          <p className="mt-2 font-display text-label" style={{ color: C.sub }}>
            Measured against your giving strategy · {fmtDateTime(summary.generatedAt)}
          </p>
        )}
      </div>
    </div>
  )
}

function InsightsPage() {
  const navigate = useNavigate({ from: '/insights' })
  const search = Route.useSearch()
  const { from, to, programmeId, tag, region } = search
  const { items, portfolio } = Route.useLoaderData()

  // ── Filter options, derived from the data itself ──
  const programmes = [
    ...new Map(items.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).values(),
  ]
    .map((g) => ({ id: g.programmeId!, name: g.programmeName ?? '--' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const allTags = [...new Set(items.flatMap((g) => g.tags))].sort()
  const regions = [
    ...new Set(items.map((g) => g.region).filter((r): r is string => Boolean(r))),
  ].sort()
  // Grants whose delivery location never resolved are a real group a reader needs to
  // reach — without an option for them they are simply missing from every location
  // slice, which reads as "we fund nowhere else" rather than "we don't know".
  const hasUnlocated = items.some((g) => !g.region)

  // ── The filtered slice every panel below describes ──
  // The date window is on the award decision — the moment the money was committed,
  // which is what every figure on this screen counts.
  const fil = items.filter((g) => {
    if (!matchesFilter(programmeId, g.programmeId)) return false
    if (!matchesAnyFilter(tag, g.tags)) return false
    // An unlocated grant answers to the `NO_REGION` option, as it does in the register.
    if (!matchesFilter(region, g.region ?? NO_REGION)) return false
    const day = g.decisionAt.slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    return true
  })

  // ── Headline stats ──
  const committed = fil.reduce((s, g) => s + g.amountAwarded, 0)
  const avgGrant = fil.length > 0 ? committed / fil.length : 0
  const amounts = fil.map((g) => g.amountAwarded)
  const minGrant = amounts.length ? Math.min(...amounts) : 0
  const maxGrant = amounts.length ? Math.max(...amounts) : 0

  // A stat card holds ONE number, so it has to speak in one unit — and the unit it
  // picks is the portfolio's own biggest, not `people`.
  //
  // `people` was hard-coded here because it is the app's DEFAULT unit, which is not a
  // reason: a foundation whose programmes all measure meals, hectares or tonnes CO₂e
  // got a card reading "—" over "no people-measured programmes here", as though it had
  // never collected an impact figure in its life. The card is labelled with whichever
  // unit it is speaking in, so it is never read as covering units it left out — and
  // the per-programme and per-theme panels below state every unit in play.
  const impactUnits = impactByUnit(fil)
  const headlineUnit = impactUnits[0] ?? null
  // Provenance-aware: prefer reported actuals, fall back to proposed. The split is
  // surfaced in the card's sub, so an estimate is never passed off as achieved impact.
  const impactEff = (headlineUnit ? fil.filter((g) => g.unitKey === headlineUnit.key) : [])
    .map(effImpact)
    .filter((e): e is { value: number; source: ImpactSource } => e !== null)
  const impactTotal = headlineUnit?.value ?? 0
  const impactProposedCount = impactEff.filter((e) => e.source === 'proposed').length
  // Grants measuring in something else — counted in the sub, never silently folded in.
  const impactOtherUnits = Math.max(0, impactUnits.length - 1)
  // The card is labelled "Impact" and the UNIT sits with the number, because the unit
  // is what the number is in — a footer reading "Items delivered" made a card about the
  // foundation's impact look like a card about one programme's counting method.
  //
  // "(incl. proposed)" stays on the FACE of the card rather than moving into the
  // tooltip with everything else: a total holding applicants' estimates being read as
  // impact achieved is a wrong answer, and a wrong answer must not be one hover away
  // from being right.
  const impactLabel = headlineUnit?.label ?? 'Impact'
  const impactSub =
    impactLabel.toLowerCase() +
    (impactProposedCount > 0 ? ' (incl. proposed)' : '') +
    (impactOtherUnits > 0
      ? ` + ${impactOtherUnits} more unit${impactOtherUnits === 1 ? '' : 's'}`
      : '')
  // The tooltip is the "+ N more units" half of the sub, spelled out: the units the
  // headline total leaves out, NAMED and totalled. "3 more units" tells a reader
  // something is missing without telling them what, which is the half of the answer
  // that annoys. Each is its own total because they measure different things — 8,400
  // meals and 1,200 people is not 9,600 of anything.
  //
  // Nothing else goes in here. Provenance is already on the face of the card, and how
  // many grants a total came from is a question the panels below answer properly — so
  // a card with no other units has no bubble rather than an under-filled one.
  const impactOtherUnitList = andList(impactUnits.slice(1).map((u) => unitPhrase(u)))

  const located = fil.filter((g) => g.deprivation)
  const locatedAmt = located.reduce((s, g) => s + g.amountAwarded, 0)
  const dep14Amt = located.reduce((s, g) => s + g.amountAwarded * decileShare(g, 4), 0)
  const dep14Pct = locatedAmt > 0 ? Math.round((dep14Amt / locatedAmt) * 100) : 0

  const committedUp = useCountUp(committed)
  const impactUp = useCountUp(impactTotal)
  const dep14Up = useCountUp(locatedAmt > 0 ? dep14Pct : 0)
  const avgUp = useCountUp(avgGrant)

  // ── Giving by programme ──
  const byProgramme = [
    ...new Map(fil.filter((g) => g.programmeId).map((g) => [g.programmeId!, g])).keys(),
  ]
    .map((pid, i) => {
      const grants = fil.filter((g) => g.programmeId === pid)
      return {
        id: pid,
        name: grants[0]!.programmeName ?? '--',
        // The colour the foundation gave the programme on /programmes, not this
        // panel's position in a list — so a programme is the same colour here, on the
        // dashboard, on its card and in its swatch. Index is the legacy fallback for
        // programmes created before `programmes.colour` existed.
        colour: resolveProgrammeColour(grants[0]!.programmeColour, i),
        committed: grants.reduce((s, g) => s + g.amountAwarded, 0),
        grants: grants.length,
        // In the programme's OWN unit, whatever that is. This panel used to state a
        // figure only where the unit was `people` — a restriction that belongs to a
        // total summed ACROSS programmes, copied to one that is a column PER
        // programme. Every programme measuring anything else showed its grant count
        // and nothing, which reads as "nobody reported" rather than "we won't say".
        impact: impactByUnit(grants),
      }
    })
    .sort((a, b) => b.committed - a.committed)
  // One colour per programme for the whole screen — the round panel below draws the
  // same programme in the same colour this panel gives it, so the two read as one set.
  const programmeColour = new Map(byProgramme.map((p) => [p.id, p.colour]))

  // ── Commitment over time (by round, chronological) ──
  // What each round committed, drawn with the dashboard's own chart (`GivingArea`, which
  // says why there is one). A bars reading and a cumulative mode both existed and were
  // dropped: the shape of the trend is the question this panel is opened for, and a
  // running total read as if the round totals themselves were growing.
  const [showAllThemes, setShowAllThemes] = useState(false)
  // Grouped in one pass: a filter per round is rounds × grants, and an imported back
  // catalogue has plenty of both.
  const grantsByRound = new Map<string, InsightsGrant[]>()
  for (const g of fil) {
    if (!g.roundId) continue
    const list = grantsByRound.get(g.roundId)
    if (list) list.push(g)
    else grantsByRound.set(g.roundId, [g])
  }
  const timelineRounds = [...grantsByRound]
    .map(([rid, own]) => {
      const grants = own.sort((a, b) => b.amountAwarded - a.amountAwarded)
      return {
        id: rid,
        name: grants[0]!.roundName ?? '--',
        openedAt: grants[0]!.roundOpenedAt,
        grants,
        programmes: roundProgrammes(grants),
        total: grants.reduce((s, g) => s + g.amountAwarded, 0),
      }
    })
    .sort((a, b) => (a.openedAt ?? '').localeCompare(b.openedAt ?? ''))
  const commitSeries: GivingPoint[] = timelineRounds.map((r) => ({
    label: r.name,
    title: r.name,
    amount: r.total,
  }))

  // ── Themes ──
  // A theme is not a programme and has no colour of its own, so it takes a generated
  // series: as many distinct colours as there are themes, off the same ramp the
  // programme palette is cut from.
  const tagNames = [...new Set(fil.flatMap((g) => g.tags))].sort()
  const themeColours = colourSeries(tagNames.length)
  const themes = tagNames
    .map((t, i) => {
      const grants = fil.filter((g) => g.tags.includes(t))
      return {
        tag: t,
        colour: themeColours[i]!,
        amount: grants.reduce((s, g) => s + g.amountAwarded, 0),
        count: grants.length,
        // A theme spans programmes, so it can span units — which is exactly why it
        // sums within each one and prints them all. It used to sum the `people`
        // grants alone and label the result "people": a theme whose grants measured
        // meals showed nothing, and a theme mixing the two showed the people and
        // silently dropped the meals.
        impact: impactByUnit(grants),
        // Every programme, not "Warm Homes + 1 other". That summary threw the names
        // away at all widths, including the ones where they fitted, and left "+1"
        // meaning nothing in particular. `TruncatedList` clips only when it must and
        // hands the rest over on hover.
        programmes: programmeNames(
          grants.map((g) => g.programmeName).filter((n): n is string => Boolean(n)),
        ),
      }
    })
    .sort((a, b) => b.amount - a.amount)
  const themedTotal = themes.reduce((s, t) => s + t.amount, 0)
  // Themes are sorted by amount, so the first three are the ones carrying the giving;
  // a foundation with a dozen tags otherwise turns this panel into a long scroll beside
  // a short chart, and the tail is mostly 1–2% rows. The rest stay one click away.
  const visibleThemes = showAllThemes ? themes : themes.slice(0, THEMES_SHOWN)

  // ── Geography: the choropleth + its donut ──
  //
  // The map drills World → United Kingdom → one region's districts. Each level
  // keys on a different field, so the values map is rebuilt per view rather than
  // derived once: countries on ISO alpha-3, regions on the persisted region
  // name, districts on the ONS LAD code.

  // Does the portfolio reach outside the UK? This decides where the map opens
  // — and only that. Every tier stays reachable whatever the answer: a funder
  // working only in Britain should *land* on Britain, but "are we only funding
  // Britain?" is a fair question to be able to ask the map out loud.
  //
  // Measured across every grant rather than the filtered slice, so narrowing a
  // filter cannot pull the map out from under someone mid-read.
  //
  // A constant rather than a test, because there is currently nothing to test:
  // an application records a region and a LAD but no country, so no grant can
  // report a delivery outside the UK. It is named and wired up as a real
  // condition anyway so the day `deliveryCountry` (ISO alpha-3, defaulting to
  // GBR) lands, this line becomes
  //   items.some((g) => g.country && g.country !== 'GBR')
  // and nothing else on the screen has to change.
  //
  // Do NOT reach for `unlocatedCount` as a stand-in. A grant with no region is
  // usually an unresolved UK postcode, not an overseas one, and treating those
  // as international would open a wholly British portfolio on a blank world map.
  const hasOverseas = false

  // A portfolio that reaches exactly ONE region opens already drilled into it: a UK map
  // with a single region painted answers nothing the reader didn't know, and the
  // districts beneath it are the first question. Same measure as `hasOverseas` — every
  // grant, not the filtered slice — and only the opening view; the breadcrumb still
  // goes back up to the UK. Unlocated grants don't count as a second region.
  const onlyRegion = regions.length === 1 ? regions[0] : undefined
  const [mapView, setMapView] = useState<MapView>(() =>
    hasOverseas
      ? { kind: 'world' }
      : onlyRegion
        ? { kind: 'region', region: onlyRegion }
        : { kind: 'uk' },
  )
  const [selArea, setSelArea] = useState<string | null>(null)
  // Whichever of the map, donut or list the pointer is over. Hoisted here
  // because the three are one exhibit: pointing at an area in any of them
  // should answer "and where is that in the other two?".
  const [hoverArea, setHoverArea] = useState<string | null>(null)
  const unlocated = fil.filter((g) => !g.region)
  const unlocatedCount = unlocated.length
  const unlocatedAmt = unlocated.reduce((s, g) => s + g.amountAwarded, 0)

  // The regions in view, or none. The map's drill wins over the filter pill: if you have
  // opened the North West on the map, that is the region you are reading, whatever the
  // filter above still says.
  const linkedRegions: string[] | null =
    mapView.kind === 'region' || mapView.kind === 'county' ? [mapView.region] : (region ?? null)

  // Which county a grant is in: its district's, off the map's own boundary file, or the
  // county it was delivered across. See `useCounties` for why the district half is not
  // read from the server.
  const counties = useCounties()
  const countyOf = (g: InsightsGrant) =>
    g.ladCode ? (counties.countyOf.get(g.ladCode) ?? null) : g.countyWide
  // The region view's rows are counties wherever the region has them, which is also
  // what makes a row drill.
  const regionByCounty = mapView.kind === 'region' && counties.regionByCounty(mapView.region)

  // Roll grants up to whichever key the current view paints. Every grant in view lands
  // SOMEWHERE — on an area, or in `wide` — so the donut totals everything in the view.
  // The region view used to add up districts only, and a grant delivered "across
  // Merseyside" has none: on one portfolio that dropped 19 of 44 grants and 55% of the
  // money from the donut, with nothing on screen to say so.
  const wide = { amount: 0, count: 0 }
  const mapValues = (() => {
    const acc = new Map<string, { amount: number; count: number }>()
    const add = (key: string | null, amount: number) => {
      if (!key) return
      const prev = acc.get(key) ?? { amount: 0, count: 0 }
      acc.set(key, { amount: prev.amount + amount, count: prev.count + 1 })
    }
    const addWide = (amount: number) => {
      wide.amount += amount
      wide.count += 1
    }
    for (const g of fil) {
      if (mapView.kind === 'world' || mapView.kind === 'country') {
        // Anything we can place is in Britain, because a region is the only
        // location an application records. Rolling those up to GBR is not a
        // guess — a resolved ONS region *is* a statement that the delivery is
        // in the UK — and without it the world tier showed a British funder
        // their own country unpainted, flatly contradicting the UK view one
        // click below. An empty world map read as broken; this one reads as
        // "all of it is here", which is the true answer.
        if (g.region) add(UK_ISO3, g.amountAwarded)
      } else if (mapView.kind === 'uk') add(g.region, g.amountAwarded)
      else if (mapView.kind === 'region') {
        if (g.region !== mapView.region) continue
        // Counties where the region has them, districts where it does not (Scotland,
        // NI). What fits neither covers the region as a whole.
        const key = regionByCounty ? countyOf(g) : g.ladCode
        if (key) add(key, g.amountAwarded)
        else addWide(g.amountAwarded)
      } else if (mapView.kind === 'county') {
        if (countyOf(g) !== mapView.county) continue
        if (g.ladCode) add(g.ladCode, g.amountAwarded)
        else addWide(g.amountAwarded)
      }
    }
    return acc
  })()
  const wideName =
    mapView.kind === 'county'
      ? `Across ${mapView.county}`
      : mapView.kind === 'region'
        ? `Across ${regionInProse(mapView.region)}`
        : ''

  // The donut mirrors whatever the map is showing: same slice of the portfolio,
  // ranked, so the two halves of the panel can never disagree.
  const areaRanked = [...mapValues.entries()]
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.amount - a.amount)
  const areaTotal = areaRanked.reduce((s, a) => s + a.amount, 0) + wide.amount
  const areaNames = useAreaNames(mapView)
  const areaColours = colourSeries(Math.min(areaRanked.length, MAX_AREAS))
  // The whole-area row takes its place in the ranking by size, but not a hue or one of
  // the MAX_AREAS slots: it is never folded into "Other areas", because a named total
  // that is the biggest thing in the view (as "Across Merseyside" can be) hidden inside
  // an anonymous tail would be the same disappearance this row exists to end.
  const topAreas = [
    ...areaRanked.slice(0, MAX_AREAS).map((a, i) => ({
      ...a,
      name: areaNames.get(a.code) ?? a.code,
      colour: areaColours[i]!,
    })),
    ...(wide.count > 0 ? [{ code: WIDE_KEY, name: wideName, colour: WIDE_COLOUR, ...wide }] : []),
  ].sort((a, b) => b.amount - a.amount)
  const restAmount = areaRanked.slice(MAX_AREAS).reduce((s, a) => s + a.amount, 0)
  const areaDonut: DonutSlice[] = [
    ...topAreas.map((a) => ({ areaId: a.code, name: a.name, value: a.amount, colour: a.colour })),
    // Never generate an 8th hue — the tail folds into one neutral "Other".
    ...(restAmount > 0 ? [{ name: 'Other areas', value: restAmount, colour: C.line }] : []),
  ]

  // IMD reach for the map's current view. Empty outside the UK — the index does
  // not exist there — and empty when nothing in the slice resolved to an area,
  // in which case the note simply doesn't render rather than showing 0%.
  const imdScope =
    mapView.kind === 'uk'
      ? located
      : mapView.kind === 'region'
        ? located.filter((g) => g.region === mapView.region)
        : mapView.kind === 'county'
          ? located.filter((g) => countyOf(g) === mapView.county)
          : []
  const imdAmt = imdScope.reduce((s, g) => s + g.amountAwarded, 0)
  const imdPct =
    imdAmt > 0
      ? Math.round(
          (imdScope.reduce((s, g) => s + g.amountAwarded * decileShare(g, 2), 0) / imdAmt) * 100,
        )
      : null

  // ── Deprivation-decile distribution ──
  const decileAmounts = fundingByDecile(located)
  const decileMax = Math.max(1, ...decileAmounts)
  const vintages = [...new Set(located.map((g) => g.deprivation!.vintage))].sort()

  function setSearch(patch: Partial<InsightsSearch>) {
    navigate({ search: (prev) => ({ ...prev, ...patch }) })
  }

  // ── Scroll reveal ──
  // One handle per export block, in page order. Each panel rises as it is reached,
  // and the charts inside the last three wait for `shown` before drawing themselves
  // in — an entry animation that finishes below the fold is one nobody ever sees.
  const kpiReveal = useReveal()
  const programmeReveal = useReveal()
  const commitReveal = useReveal()
  const areaReveal = useReveal()
  const decileReveal = useReveal()
  const impactReveal = useReveal()

  // ── PDF export ──
  const exportRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState(false)
  const periodLabel = formatDateRange({ from, to })
  const programmeLabel = summariseSelection(
    (programmeId ?? []).map(
      (id) => programmes.find((p) => p.id === id)?.name ?? 'Selected programme',
    ),
    'All programmes',
  )
  const themeLabel = summariseSelection(tag ?? [], 'All themes')
  const regionLabel = summariseSelection(
    (region ?? []).map((r) => (r === NO_REGION ? 'No location recorded' : r)),
    'All locations',
  )
  async function handleExport() {
    const root = exportRef.current
    if (!root) return
    setExporting(true)
    try {
      // `exporting` puts `.reveal-all` on the capture root, and html2canvas reads
      // computed styles off the live DOM — so the class has to have been painted
      // before the capture starts. Without the frame, a panel the reader never
      // scrolled to is photographed at opacity 0 and comes out a blank page.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      await exportInsightsPdf(root, {
        title: 'Insights',
        filters: `${periodLabel} · ${programmeLabel} · ${themeLabel} · ${regionLabel}`,
        summary: `${fil.length} award${fil.length !== 1 ? 's' : ''} · ${fmtMoney(committed)} committed`,
        generatedAt: new Date().toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
      })
    } finally {
      setExporting(false)
    }
  }

  // Rendered in both branches below — the empty slice and the full stack — because it
  // describes the portfolio rather than the slice.
  const summaryPanel = (
    <PortfolioSummary
      summary={portfolio.summary}
      hasStrategy={portfolio.hasStrategy}
      hasGrants={items.length > 0}
      filtered={Boolean(programmeId || tag || region || from || to)}
    />
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Header — the title and the export of exactly what's on screen */}
      <div className="flex flex-wrap justify-between gap-3">
        <h1 className="font-display text-heading font-medium">
          <span style={{ color: C.ink }}>The story </span>
          <span style={{ color: C.faint }}>so far</span>
        </h1>
        {fil.length > 0 && (
          <ExportButton
            onClick={handleExport}
            busy={exporting}
            label="Export PDF"
            busyLabel="Preparing…"
          />
        )}
      </div>

      {/* Filters — the slice every panel below describes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Every pill is always rendered, which is the rule the whole app now follows
            (`ui/FilterPill`) and which started here: hiding a filter until it had two
            values meant Location vanished on any portfolio where only one delivery area
            had resolved — read as the filter not existing rather than the data being
            thin. Insights' options are plain lists rather than counted facets, because
            the panels below already count everything the slice contains. */}
        <div className="flex flex-wrap items-center gap-3">
          <FilterPill
            label="Programme"
            plural="programmes"
            value={programmeId}
            options={programmes.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => setSearch({ programmeId: v })}
          />
          <FilterPill
            label="Theme"
            plural="themes"
            value={tag}
            options={allTags.map((t) => ({ value: t, label: t }))}
            onChange={(v) => setSearch({ tag: v })}
          />
          <FilterPill
            label="Location"
            plural="locations"
            value={region}
            options={[
              ...regions.map((r) => ({ value: r, label: r })),
              ...(hasUnlocated ? [{ value: NO_REGION, label: 'No location recorded' }] : []),
            ]}
            onChange={(v) => setSearch({ region: v })}
          />
        </div>
        <DateRangePicker
          value={{ from, to }}
          onChange={(next) => setSearch({ from: next.from, to: next.to })}
        />
      </div>

      {fil.length === 0 ? (
        <>
          <EmptyState>
            <p className="font-display text-body" style={{ color: C.sub }}>
              No awards match these filters.
            </p>
            <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
              Insights build up as awards are made and grant reports are analysed.
            </p>
          </EmptyState>
          {/* The summary reads the whole portfolio, not the slice, so it is still
              worth printing when the slice is empty — here it is the only thing on the
              screen with anything to say. */}
          {summaryPanel}
        </>
      ) : (
        <div ref={exportRef} className={`flex flex-col gap-4 ${exporting ? 'reveal-all' : ''}`}>
          {/* KPI cards */}
          <div
            data-export-block
            ref={kpiReveal.ref}
            {...kpiReveal.props}
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${kpiReveal.props.className}`}
          >
            <MiniKpi
              size="lg"
              tint={KPI.committed}
              icon={Coins01Icon}
              label="Total committed"
              value={<CompactMoney amount={committedUp} label="Exact total committed" />}
              // The broadest way in: this count IS the slice every other figure on the
              // screen is computed from, so the register it opens is that slice exactly.
              sub={
                <>
                  across <GrantCount n={fil.length} slice={search} />
                </>
              }
            />
            <MiniKpi
              size="lg"
              tint={KPI.people}
              // A globe, not the people glyph this card was born with: the unit is
              // whatever the programme measures — meals, hectares, hours — so an icon
              // that says "people" is the same mistake the old label made.
              icon={EarthIcon}
              label="Impact"
              value={impactEff.length > 0 ? Math.round(impactUp).toLocaleString('en-GB') : '--'}
              sub={
                impactEff.length === 0 ? (
                  'no impact figures yet'
                ) : impactOtherUnits === 0 ? (
                  impactSub
                ) : (
                  // The sub line IS the trigger: it is the thing being explained, and a
                  // second ⓘ beside it would be a mark to explain the mark. `trigger`
                  // gives it the focus, Escape and `aria-describedby` wiring, so the
                  // detail is reachable by keyboard rather than hover-only.
                  <Tooltip
                    label={`About this ${impactLabel.toLowerCase()} figure`}
                    className="flex min-w-0"
                    triggerClassName="block min-w-0 truncate rounded-chip focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
                    trigger={impactSub}
                  >
                    {impactOtherUnitList}
                  </Tooltip>
                )
              }
            />
            <MiniKpi
              size="lg"
              tint={KPI.reach}
              icon={Location01Icon}
              label="Deprivation reach"
              value={locatedAmt > 0 ? `${Math.round(dep14Up)}%` : '--'}
              sub={locatedAmt > 0 ? 'reached IMD decile 1–4' : 'no resolved locations yet'}
            />
            <MiniKpi
              size="lg"
              tint={KPI.avg}
              icon={ChartAverageIcon}
              label="Average grant"
              value={<CompactMoney amount={avgUp} label="Exact average grant" />}
              sub={
                amounts.length ? (
                  <>
                    <CompactMoney amount={minGrant} label="Exact smallest grant" />–
                    <CompactMoney amount={maxGrant} label="Exact largest grant" /> range
                  </>
                ) : (
                  'across filtered awards'
                )
              }
            />
          </div>

          {/* Giving by programme */}
          {byProgramme.length > 0 && (
            <Panel data-export-block innerRef={programmeReveal.ref} {...programmeReveal.props}>
              <PanelTitle>Giving by programme</PanelTitle>
              {/* Columns are sized by share of the total, so the row reads as one
                  100%-wide bar broken into programmes — and each meter fills its
                  column rather than leaving a fixed grid half-empty. */}
              <div className="flex flex-col gap-5 sm:flex-row sm:gap-0">
                {byProgramme.map((p, i) => {
                  const pct = committed > 0 ? Math.round((p.committed / committed) * 100) : 0
                  return (
                    <Fragment key={p.id}>
                      {i > 0 && (
                        <span
                          aria-hidden
                          className="mx-4 hidden w-px shrink-0 sm:block"
                          style={{ height: 56, backgroundColor: C.line }}
                        />
                      )}
                      <div className="min-w-0" style={{ flex: `${Math.max(pct, 6)} 1 0%` }}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className="font-display text-heading font-medium"
                            style={{ color: C.ink }}
                          >
                            <CompactMoney amount={p.committed} label="Exact committed" />
                          </span>
                          <span
                            className="font-display text-body font-medium"
                            style={{ color: C.faint }}
                          >
                            {pct}%
                          </span>
                        </div>
                        <BarMeter
                          fill
                          height={24}
                          barWidth={3}
                          className="my-2 w-full"
                          segments={[{ value: 1, colour: p.colour }]}
                        />
                        <div
                          className="font-display text-body font-medium"
                          style={{ color: C.ink }}
                        >
                          <TruncatedText text={p.name} label="Programme name" />
                        </div>
                        {/* `TruncatedText`, as the programme name above it — these
                            columns are sized by share of the total, so a small
                            programme's is narrow enough to clip "31,000 items
                            delivered" to "31,000 ite…", and a bare CSS truncate leaves
                            the number with no way to be read. */}
                        <CountLine
                          count={p.grants}
                          rest={programmeRest(p)}
                          slice={search}
                          narrow={p.id ? { programmeId: [p.id] } : undefined}
                          className="font-display text-label"
                        />
                      </div>
                    </Fragment>
                  )
                })}
              </div>
            </Panel>
          )}

          {/* Commitment over time + Themes */}
          <div
            data-export-block
            ref={commitReveal.ref}
            {...commitReveal.props}
            className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${commitReveal.props.className}`}
          >
            <Panel>
              <PanelTitle>Commitment over time</PanelTitle>
              {commitSeries.length === 0 ? (
                <p className="py-10 text-center font-display text-body" style={{ color: C.faint }}>
                  No dated rounds in this slice.
                </p>
              ) : (
                <>
                  <p className="-mt-2 mb-4 font-display text-label" style={{ color: C.sub }}>
                    By grant round · £ committed
                  </p>
                  <GivingArea
                    // Re-keyed on reveal so the draw-in plays when the panel is
                    // reached rather than below the fold, as the area donut does.
                    key={commitReveal.shown ? 'shown' : 'idle'}
                    animate={commitReveal.shown}
                    data={commitSeries}
                    height={240}
                    // Round names are free text; the tooltip carries the whole one.
                    maxTickChars={16}
                  />
                </>
              )}
            </Panel>

            <Panel>
              <PanelTitle>Themes</PanelTitle>
              {themes.length === 0 ? (
                <p className="py-10 text-center font-display text-body" style={{ color: C.faint }}>
                  No programme tags set. Add tags to programmes to see themed giving.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {visibleThemes.map((t) => {
                    const pct = themedTotal > 0 ? Math.round((t.amount / themedTotal) * 100) : 0
                    return (
                      // A white wrapper card holds the tinted headline and the line
                      // beneath it — which names the programmes the theme spans, so a
                      // theme is never just a percentage with no provenance.
                      <div
                        key={t.tag}
                        className="flex flex-col gap-1 rounded-card border bg-white px-1 pb-2 pt-1"
                        style={{ borderColor: C.line }}
                      >
                        <div
                          className="flex items-center gap-4 rounded-control p-3"
                          style={{ backgroundColor: withAlpha(t.colour, 0.1) }}
                        >
                          <div className="min-w-0 flex-1">
                            <div
                              className="font-display text-body font-medium"
                              style={{ color: C.ink }}
                            >
                              <TruncatedText text={t.tag} label="Theme" />
                            </div>
                            {/* `TruncatedText`, as the theme name above it: a theme
                                spanning three units has a long line, and a clipped
                                figure with no way to read it is worse than no
                                figure. */}
                            <CountLine
                              count={t.count}
                              rest={themeRest(t)}
                              slice={search}
                              narrow={{ tag: [t.tag] }}
                              className="mt-1 font-display text-label"
                            />
                          </div>
                          <span
                            className="shrink-0 font-display text-heading font-medium leading-none"
                            style={{ color: t.colour }}
                          >
                            {pct}
                            <span className="text-title" style={{ color: C.faint }}>
                              %
                            </span>
                          </span>
                        </div>
                        <div className="px-3">
                          <TruncatedList
                            items={t.programmes}
                            label={`Programmes funding ${t.tag}`}
                            empty="No programme recorded"
                            className="font-display text-label text-grey-500"
                          />
                        </div>
                      </div>
                    )
                  })}
                  {themes.length > THEMES_SHOWN && (
                    <button
                      type="button"
                      onClick={() => setShowAllThemes((v) => !v)}
                      className="self-start px-3 pt-1 font-display text-label font-medium underline underline-offset-2"
                      style={{ color: C.sub }}
                    >
                      {showAllThemes ? 'Show fewer themes' : `Show all ${themes.length} themes`}
                    </button>
                  )}
                </div>
              )}
            </Panel>
          </div>

          {/* Giving by area */}
          {/* Guarded on the slice, NOT on the current view's values: a view with
              nothing to paint (e.g. World, before grants carry a country) must
              render an empty map, never unmount the panel under the user. */}
          {fil.length > 0 && (
            <Panel data-export-block innerRef={areaReveal.ref} {...areaReveal.props}>
              <PanelTitle>Giving by area</PanelTitle>

              {/* The map column is deliberately the narrower of the two. The UK
                  is a portrait shape and the frame is fitted to it, so a wide
                  column buys a very tall panel; a narrow one lets Britain fill
                  its width and keeps the panel the height of the list beside
                  it. */}
              <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)]">
                <div className="flex flex-col">
                  <Choropleth
                    // The shrink is for PORTRAIT views only. The UK is a portrait shape
                    // fitted to its column, so at full width this panel ran taller than
                    // everything beside it and the map was the reason; 70% keeps the
                    // donut and the list where they are. The world is the opposite shape
                    // — landscape, fitted at about 1.7:1 — so the same 70% bought nothing
                    // and cost height, leaving a letterbox with white either side of it.
                    // At full column width it draws around 40% taller with no more space
                    // taken from the panel than the UK view already takes.
                    scale={mapView.kind === 'world' || mapView.kind === 'country' ? 1 : 0.7}
                    view={mapView}
                    onViewChange={(v) => {
                      setMapView(v)
                      // Zooming to a country keeps it selected, so the donut
                      // beside the map highlights the place you just opened
                      // instead of clearing under you.
                      setSelArea(v.kind === 'country' ? v.code : null)
                    }}
                    values={mapValues}
                    selected={selArea}
                    onSelect={setSelArea}
                    // The whole-area row has no shape of its own to light: the map
                    // outlines everything in view for it instead of dimming it all.
                    highlight={hoverArea === WIDE_KEY ? null : hoverArea}
                    onHighlight={setHoverArea}
                    outlineAll={hoverArea === WIDE_KEY || selArea === WIDE_KEY}
                  />
                  <MapAttribution view={mapView} />
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex justify-center">
                    <Donut
                      // Recharts sweeps the ring on mount. Remounting on reveal is
                      // what moves that sweep to the moment the panel is reached;
                      // before then the ring is drawn whole and simply sits inside a
                      // panel at opacity 0, so the PDF export never catches a sliver.
                      key={areaReveal.shown ? 'shown' : 'idle'}
                      animate={areaReveal.shown}
                      data={areaDonut}
                      size={132}
                      thickness={16}
                      highlight={hoverArea}
                      onHighlight={setHoverArea}
                      center={
                        <div className="text-center">
                          <div
                            className="font-display text-heading font-medium"
                            style={{ color: C.ink }}
                          >
                            <CompactMoney amount={areaTotal} label="Exact total for this area" />
                          </div>
                          <div className="font-display text-label" style={{ color: C.faint }}>
                            committed
                          </div>
                        </div>
                      }
                    />
                  </div>

                  <AreaList
                    areas={topAreas}
                    total={areaTotal}
                    rest={restAmount}
                    selected={selArea}
                    highlight={hoverArea}
                    onHighlight={setHoverArea}
                    // Only the UK tier has a level beneath it that a list row
                    // can open. Districts are the floor, and the world tier's
                    // rows are countries whose drill target is a zoom the map
                    // owns — offering a chevron there would promise a
                    // breakdown that does not exist.
                    // Rows act exactly as the same area does on the map — same
                    // rule, from the same function, so the two halves of the
                    // panel can never disagree about what a click means.
                    drillOf={(code, name, funded) =>
                      code === WIDE_KEY
                        ? null
                        : drillTarget(mapView, code, name, funded, regionByCounty)
                    }
                    slice={search}
                    // Only the UK tier's rows are regions, which is the one geography
                    // the register filters on. Countries above and districts below have
                    // no equivalent there, so their counts stay text — see `narrowOf`.
                    // The code is what the values were grouped BY (`g.region`), so it is
                    // the string handed over, never the display name beside it.
                    narrowOf={(code) => (mapView.kind === 'uk' ? { region: [code] } : null)}
                    onPick={(code, name, to) => {
                      setSelArea(code)
                      if (to) setMapView(to)
                    }}
                  />

                  {imdPct !== null && <ImdNote pct={imdPct} />}

                  {/* With its money, not just its count: this is the one grant set the
                      donut above cannot hold, so it is what explains the difference
                      between the donut's total and Total committed. */}
                  {unlocatedCount > 0 && (
                    <p className="font-display text-label" style={{ color: C.faint }}>
                      {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} (
                      {fmtCompact(unlocatedAmt)}) with no resolvable location, not counted above.
                    </p>
                  )}

                  {/* The way OUT of this panel, and the map's stand-in for the linked
                      count every other panel now carries: a row here is a drill control,
                      so its count cannot also be a link (see `GrantCount`) and the panel
                      offers one link of its own instead.

                      It appears only with a region in view — drilled on the map, or one
                      or more picked in the filter above. With none picked there is no
                      honest link: "all of them" is just the register. The values
                      handed over are `g.region`, the same strings the register groups on
                      (`deliveryRegionLabel`, shared); a link built from a display label
                      would land on an empty list and say nothing about why.

                      It carries the whole slice exactly as `GrantCount` does, so the two
                      cannot open different registers from the same panel. */}
                  {linkedRegions && (
                    <Link
                      to="/awards"
                      search={{
                        from: search.from,
                        to: search.to,
                        programmeId: search.programmeId,
                        tag: search.tag,
                        region: linkedRegions,
                      }}
                      className="self-start font-display text-label font-medium underline underline-offset-2"
                      style={{ color: C.sub }}
                    >
                      {linkedRegions.length > 1
                        ? `View grants in these ${linkedRegions.length} locations`
                        : linkedRegions[0] === NO_REGION
                          ? 'View the grants with no location recorded'
                          : `View grants in ${linkedRegions[0]}`}
                    </Link>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {/* Deprivation-decile distribution */}
          <Panel data-export-block innerRef={decileReveal.ref} {...decileReveal.props}>
            <PanelTitle>Funding by deprivation decile</PanelTitle>
            {locatedAmt === 0 ? (
              <p className="py-10 text-center font-display text-body" style={{ color: C.faint }}>
                No resolved delivery locations in this slice.
              </p>
            ) : (
              <>
                <p className="-mt-1 mb-1 font-display text-label" style={{ color: C.sub }}>
                  Decile 1 is the most deprived 10% of areas in its nation
                  {vintages.length ? ` · ${vintages.join(', ')}` : ''}
                </p>
                <DecileChart
                  amounts={decileAmounts}
                  total={locatedAmt}
                  max={decileMax}
                  play={decileReveal.shown}
                />
                {unlocatedCount > 0 && (
                  <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
                    {unlocatedCount} award{unlocatedCount !== 1 ? 's' : ''} without a resolvable
                    location excluded.
                  </p>
                )}
              </>
            )}
          </Panel>

          {summaryPanel}

          {/* Impact by round */}
          {timelineRounds.length > 0 && (
            <Panel data-export-block innerRef={impactReveal.ref} {...impactReveal.props}>
              <PanelTitle>Impact by round</PanelTitle>
              <div className="flex flex-col gap-5">
                {timelineRounds
                  .slice()
                  .reverse()
                  .map((r) => (
                    <div key={r.id}>
                      <div className="mb-2.5 flex items-center gap-2.5">
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: C.brand }}
                        />
                        <span
                          className="font-display text-body font-medium"
                          style={{ color: C.ink }}
                        >
                          {r.name}
                        </span>
                        <span className="font-display text-label" style={{ color: C.sub }}>
                          {r.programmes.length} programme{r.programmes.length !== 1 ? 's' : ''} ·{' '}
                          <GrantCount
                            n={r.grants.length}
                            slice={search}
                            narrow={{ roundId: [r.id] }}
                          />{' '}
                          · <CompactMoney amount={r.total} label="Exact total for this round" />
                        </span>
                        <span className="h-px flex-1" style={{ backgroundColor: C.line }} />
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {r.programmes.map((p) => (
                          <RoundProgrammeCard
                            key={p.id ?? '--'}
                            programme={p}
                            roundId={r.id}
                            slice={search}
                            colour={(p.id && programmeColour.get(p.id)) || C.sub}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  )
}

function RoundProgrammeCard({
  programme: p,
  roundId,
  slice,
  colour,
}: {
  programme: RoundProgramme
  roundId: string
  slice: InsightsSearch
  colour: string
}) {
  const impact =
    p.impact.length === 0 ? 'no impact figures yet' : p.impact.map(unitPhrase).join(' · ')
  const bg = { backgroundColor: `color-mix(in srgb, ${colour} 12%, transparent)` }
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* The swatch carries the colour; the text never does — at the palette's
                fixed lightness these hues sit near 3:1 on white. */}
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: colour }}
              aria-hidden
            />
            <p className="truncate font-display text-body font-medium" style={{ color: C.ink }}>
              {p.name}
            </p>
          </div>
          <p className="mt-0.5 font-display text-label" style={{ color: C.sub }}>
            {p.grants} grant{p.grants !== 1 ? 's' : ''}
          </p>
        </div>
        <span className="shrink-0 font-display text-heading font-medium" style={{ color: C.ink }}>
          <CompactMoney amount={p.total} label="Exact total for this programme" />
        </span>
      </div>
      <p className="mt-3 truncate font-display text-label" style={{ color: C.sub }} title={impact}>
        {impact}
      </p>
    </>
  )
  // The card opens the Awards register on exactly these grants: this round, this
  // programme, inside the slice being read. It carries the slice the same way
  // `GrantCount` does, with the card's own round and programme narrowing it, so the
  // register lists the grants the card counted (plus any cancelled ones, pilled, for the
  // reason given there). An unresolved pairing has no programme to filter on, and a
  // round-only link would open onto other programmes' grants, so it stays inert.
  return p.id ? (
    <Link
      to="/awards"
      search={{
        from: slice.from,
        to: slice.to,
        programmeId: [p.id],
        tag: slice.tag,
        region: slice.region,
        roundId: [roundId],
      }}
      className="block rounded-card p-4 transition-shadow hover:shadow-xs"
      style={bg}
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-card p-4" style={bg}>
      {body}
    </div>
  )
}
