import { useEffect, useMemo, useRef, useState } from 'react'
import { geoConicEqualArea, geoEqualEarth, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { chart, fmtMoney, tooltipBox } from './theme'

// Choropleth — "where the money went", as boundaries rather than a tile grid.
//
// Deliberately not a map library. There is no basemap, no tile server and no
// API key: every shape is an SVG <path> we style with the same tokens as every
// other chart on the screen, which is why it can match the Figma instead of
// fighting someone else's cartography. Boundaries are built by
// `pnpm geo:build` into public/geo — see scripts/build-geo.ts.
//
// Scale note: SVG hit-testing starts to feel sticky somewhere north of ~2,000
// paths. The largest view here is the world at 177, and the busiest UK view is
// all 361 LADs, so we are an order of magnitude clear. Going below LAD level
// nationally (LSOAs are ~35k) would mean canvas or vector tiles instead.

// ─── Sequential ramp ────────────────────────────────────────────────────────────
// Magnitude, so: one hue, five steps, light→dark, stepped in OKLab off the brand
// green. Validated as an ordinal ramp (monotone lightness, adjacent ΔL ≥ 0.06,
// light end ≥ 2:1 on white, single hue — spread is 1°). Do not hand-tweak a step
// without re-running that check; the light end in particular sits deliberately
// close to its 2:1 floor and a "nicer" paler green would disappear on the panel.
const RAMP = ['#87B5A1', '#69A089', '#4B8B71', '#29765B', '#006145'] as const

// Areas with no grants. Distinct from — and lighter than — every ramp step, so
// "we funded nothing here" can never be misread as "we funded a little here".
const EMPTY = '#F2F4F7'

// The one country with a layer beneath it, so it is the one country on the
// world map that drills rather than selects.
const UK_ISO3 = 'GBR'

// Frame shape for a zoomed country. Slightly landscape: it suits the majority
// of countries and sits close enough to the UK view's 0.78 that switching
// between tiers doesn't feel like the panel resized.
const COUNTRY_ASPECT = 1.3

export type MapView =
  | { kind: 'world' }
  /** Zoomed to one country. A leaf everywhere except the UK, which has its own
   *  region + district layers and so gets `uk` instead. */
  | { kind: 'country'; code: string; name: string }
  | { kind: 'uk' }
  /** One English region (or Wales/Scotland/NI) broken into its districts. */
  | { kind: 'region'; region: string }

export type AreaDatum = { amount: number; count: number }

type GeoProps = { code: string; name: string; region?: string | null; continent?: string }
type GeoFeature = Feature<Geometry, GeoProps>

// Each view names its file, the object inside it, which property keys into the
// caller's data, and the aspect it wants to be drawn at.
//
// The keys differ by design, and follow whatever the application row actually
// stores: countries key on ISO alpha-3, districts on the ONS LAD code
// (`DeliveryGeo.ladCode`) — but regions key on the *name*, because
// `DeliveryGeo.region` is a display string like "Yorkshire and The Humber", not
// a code. Keying regions on `code` silently paints nothing.
//
// Aspect is per-view because one box cannot serve both: the UK is portrait and
// the world is a wide letterbox, and a shared frame strands whichever one it
// wasn't sized for in a sea of margin.
const SOURCES = {
  world: { url: '/geo/world.json', object: 'countries', key: 'code', aspect: 1.9 },
  uk: { url: '/geo/uk.json', object: 'regions', key: 'name', aspect: 0.78 },
  lad: { url: '/geo/uk-lad.json', object: 'lads', key: 'code', aspect: 0.95 },
} as const

function sourceFor(view: MapView) {
  // A zoomed country is still the world layer — the zoom is a projection fit,
  // not a different file. Nothing below country level exists outside the UK.
  if (view.kind === 'world' || view.kind === 'country') return SOURCES.world
  return view.kind === 'uk' ? SOURCES.uk : SOURCES.lad
}

/** The value in `values` this feature is looked up by, per the view's key. */
function keyOf(f: GeoFeature, key: 'code' | 'name') {
  return key === 'name' ? f.properties.name : f.properties.code
}

// ─── Boundary loading ───────────────────────────────────────────────────────────
// Module-level cache: boundaries are immutable static assets, so a given file is
// fetched at most once per page load however often the view flips between levels.
const cache = new Map<string, Promise<FeatureCollection<Geometry, GeoProps>>>()

function loadGeo(url: string, object: string) {
  const key = `${url}#${object}`
  let hit = cache.get(key)
  if (!hit) {
    hit = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
        return r.json()
      })
      // topojson → geojson. The cast is safe by construction: build-geo.ts
      // filters every layer down to exactly the GeoProps fields.
      .then(
        (topo) => feature(topo, topo.objects[object]) as unknown as FeatureCollection<Geometry, GeoProps>,
      )
    cache.set(key, hit)
  }
  return hit
}

function useGeo(view: MapView) {
  const src = sourceFor(view)
  const [state, setState] = useState<{
    data: FeatureCollection<Geometry, GeoProps> | null
    error: string | null
  }>({ data: null, error: null })

  useEffect(() => {
    let live = true
    setState((s) => (s.data || s.error ? { data: null, error: null } : s))
    loadGeo(src.url, src.object).then(
      (data) => live && setState({ data, error: null }),
      (err: Error) => live && setState({ data: null, error: err.message }),
    )
    return () => {
      live = false
    }
  }, [src.url, src.object])

  return state
}

/**
 * Area code → display name for the current view, read from the same cached
 * boundary file the map draws. Lets a sibling panel (the donut) label areas
 * without the caller keeping its own copy of every LAD and country name.
 * Returns an empty map until the boundaries land.
 */
export function useAreaNames(view: MapView) {
  const { data } = useGeo(view)
  return useMemo(() => {
    const m = new Map<string, string>()
    const key = sourceFor(view).key
    for (const f of data?.features ?? []) m.set(keyOf(f, key), f.properties.name)
    return m
  }, [data, view])
}

// ─── Buckets ────────────────────────────────────────────────────────────────────
/**
 * Quantile thresholds over the funded areas only. Grant distributions are
 * heavily skewed — one big city can hold a third of a portfolio — and equal
 * intervals on that put everything in the palest bucket and waste the ramp.
 * Quantiles keep every step populated, so the map actually discriminates.
 */
function thresholds(values: number[]) {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (sorted.length === 0) return []
  return Array.from(
    { length: RAMP.length - 1 },
    (_, i) => sorted[Math.floor(((i + 1) / RAMP.length) * sorted.length)] ?? sorted.at(-1)!,
  )
}

function bucketOf(value: number, cuts: number[]) {
  if (value <= 0) return -1
  let i = 0
  while (i < cuts.length && value >= cuts[i]!) i++
  return Math.min(i, RAMP.length - 1)
}

// ─── Component ──────────────────────────────────────────────────────────────────
export function Choropleth({
  view,
  onViewChange,
  values,
  selected,
  onSelect,
  showWorld = false,
}: {
  view: MapView
  onViewChange: (view: MapView) => void
  /** Keyed ISO alpha-3 (world), region name (uk), or ONS LAD code (region). */
  values: Map<string, AreaDatum>
  selected: string | null
  onSelect: (key: string, name: string) => void
  /** Offer the World tier. False when no grant carries a country to paint. */
  showWorld?: boolean
}) {
  const { data, error } = useGeo(view)
  const [hover, setHover] = useState<{ x: number; y: number; f: GeoFeature } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const src = sourceFor(view)
  const width = 520

  const { features, pathFor, height } = useMemo(() => {
    const fallbackHeight = Math.round(width / src.aspect)
    if (!data) return { features: [] as GeoFeature[], pathFor: null, height: fallbackHeight }

    // The region view is a filter on the national LAD layer rather than its own
    // file — London's 33 boroughs are simply the LADs whose region is London.
    // Every other view draws its whole layer: on a zoomed country the
    // surrounding countries are what make it legible as a place rather than a
    // shape floating in white.
    const feats =
      view.kind === 'region'
        ? data.features.filter((f) => f.properties.region === view.region)
        : data.features

    // What the projection is fitted to — which is NOT always what is drawn. A
    // country view draws the world and frames one country.
    const target =
      view.kind === 'country'
        ? data.features.filter((f) => f.properties.code === view.code)
        : feats
    if (target.length === 0) return { features: feats, pathFor: null, height: fallbackHeight }

    const targetCollection = {
      type: 'FeatureCollection',
      features: target,
    } as FeatureCollection

    // A fixed frame, NOT one sized to the country's bounding box. Fitting the
    // frame to each country was the obvious move and was wrong in use: Ukraine
    // is wide and short, Bangladesh tall and narrow, so the panel lurched by
    // hundreds of pixels on every click and the donut beside it jumped with it.
    // The projection still fits the country inside this frame, so a tall
    // country simply keeps margin either side — where its neighbours show, which
    // is context rather than waste.
    const aspect = view.kind === 'country' ? COUNTRY_ASPECT : src.aspect
    const h = Math.round(width / aspect)

    // Equal-area throughout: a choropleth compares areas, and Mercator would
    // inflate Scotland and the high latitudes into a quiet lie about the data.
    const projection =
      view.kind === 'world' || view.kind === 'country'
        ? geoEqualEarth()
        : geoConicEqualArea().parallels([50, 60]).rotate([4.4, 0])

    const pad = 8
    projection.fitExtent(
      [
        [pad, pad],
        [width - pad, h - pad],
      ],
      targetCollection,
    )
    return { features: feats, pathFor: geoPath(projection), height: h }
  }, [data, view, width, src.aspect])

  const cuts = useMemo(
    () => thresholds([...values.values()].map((v) => v.amount)),
    [values],
  )

  const total = useMemo(
    () => [...values.values()].reduce((s, v) => s + v.amount, 0),
    [values],
  )

  if (error) {
    return (
      <Frame height={height}>
        <p className="font-display text-[13px]" style={{ color: chart.sub }}>
          Couldn’t load the map boundaries.
        </p>
      </Frame>
    )
  }
  if (!pathFor) return <Frame height={height}>{null}</Frame>

  const funded = features.filter((f) => (values.get(keyOf(f, src.key))?.amount ?? 0) > 0).length

  return (
    <div>
      <Breadcrumb view={view} onViewChange={onViewChange} showWorld={showWorld} />

      <div ref={wrap} className="relative" onMouseLeave={() => setHover(null)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          // Not `overflow: visible` — a zoomed country fits its own bounds, so
          // its neighbours extend well past the viewBox and would otherwise
          // paint over the legend and the panel beside it.
          style={{ width: '100%', height: 'auto', display: 'block' }}
          role="img"
          aria-label={`Funding by area — ${funded} of ${features.length} areas funded, ${fmtMoney(total)} total`}
        >
          {features.map((f) => {
            const d = pathFor(f)
            if (!d) return null
            const areaKey = keyOf(f, src.key)
            const datum = values.get(areaKey)
            const amount = datum?.amount ?? 0
            const b = bucketOf(amount, cuts)
            const isSel = selected === areaKey
            // Drilling down a level: a funded UK region opens its districts,
            // and the UK on the world map opens the UK. Everything else is a
            // leaf — there is no layer beneath a district or a foreign country.
            const drillTo: MapView | null =
              view.kind === 'uk' && amount > 0
                ? { kind: 'region', region: f.properties.name }
                : view.kind === 'world' || view.kind === 'country'
                  ? f.properties.code === UK_ISO3
                    // The UK skips the country tier: it has real layers beneath
                    // it, and stopping at a flat national outline would hide them.
                    ? { kind: 'uk' }
                    : { kind: 'country', code: f.properties.code, name: f.properties.name }
                  : null
            // Unfunded areas are inert at UK levels — there is nothing to show.
            // On the world map every country can still be zoomed to, so the
            // whole map stays explorable rather than only its funded corners.
            const interactive = amount > 0 || drillTo !== null

            return (
              <path
                key={areaKey}
                d={d}
                fill={b < 0 ? EMPTY : RAMP[b]}
                // A hairline in the surface colour is the 2px-gap rule at map
                // scale: it keeps two same-bucket neighbours legible as two
                // areas without drawing an outline that competes with the fill.
                stroke="#fff"
                strokeWidth={isSel ? 0 : 0.75}
                style={{
                  cursor: interactive ? 'pointer' : 'default',
                  transition: 'fill 180ms ease',
                  outline: 'none',
                }}
                // Only funded areas take focus. Making all 177 countries
                // tabbable would bury the rest of the page under dead stops,
                // and an unfunded area has nothing to show on activation.
                tabIndex={interactive ? 0 : undefined}
                role={interactive ? 'button' : undefined}
                aria-label={
                  !interactive
                    ? undefined
                    : datum
                      ? `${f.properties.name}: ${fmtMoney(amount)} across ${datum.count} grant${datum.count !== 1 ? 's' : ''}`
                      : `${f.properties.name}: no funding`
                }
                onMouseMove={(e) => {
                  const box = wrap.current?.getBoundingClientRect()
                  if (box) setHover({ x: e.clientX - box.left, y: e.clientY - box.top, f })
                }}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover({ x: width / 2, y: 8, f })}
                onBlur={() => setHover(null)}
                onClick={() => {
                  if (!interactive) return
                  onSelect(areaKey, f.properties.name)
                  if (drillTo) onViewChange(drillTo)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  if (!interactive) return
                  onSelect(areaKey, f.properties.name)
                  if (drillTo) onViewChange(drillTo)
                }}
              />
            )
          })}

          {/* Selection ring drawn last so it is never overpainted by a neighbour. */}
          {features.map((f) => {
            if (selected !== keyOf(f, src.key)) return null
            const d = pathFor(f)
            return d ? (
              <path
                key={`sel-${keyOf(f, src.key)}`}
                d={d}
                fill="none"
                stroke={chart.ink}
                strokeWidth={1.75}
                strokeLinejoin="round"
                pointerEvents="none"
              />
            ) : null
          })}
        </svg>

        {hover && <HoverCard hover={hover} values={values} areaKey={keyOf(hover.f, src.key)} />}
      </div>

      {funded === 0 && (
        <p className="mt-2 font-display text-[12px]" style={{ color: chart.sub }}>
          {view.kind === 'world'
            ? 'No grant in this slice records a country outside the UK.'
            : view.kind === 'country'
              ? `No grant in this slice was delivered in ${view.name}.`
              : 'No grant in this slice resolved to an area here.'}
        </p>
      )}

      <Legend cuts={cuts} hasEmpty={features.length > funded} />
    </div>
  )
}

function Frame({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl"
      style={{ height, backgroundColor: chart.dot }}
    >
      {children}
    </div>
  )
}

function HoverCard({
  hover,
  values,
  areaKey,
}: {
  hover: { x: number; y: number; f: GeoFeature }
  values: Map<string, AreaDatum>
  areaKey: string
}) {
  const d = values.get(areaKey)
  return (
    <div
      style={{
        ...tooltipBox,
        position: 'absolute',
        left: hover.x,
        top: hover.y,
        // Ride above-left of the cursor so the pointer never covers the value,
        // and never intercept the mouse — that would strobe the hover state.
        transform: 'translate(-50%, calc(-100% - 10px))',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 60,
      }}
    >
      <div style={{ color: chart.ink, fontWeight: 500 }}>{hover.f.properties.name}</div>
      <div style={{ color: chart.sub, marginTop: 2 }}>
        {d ? `${fmtMoney(d.amount)} · ${d.count} grant${d.count !== 1 ? 's' : ''}` : 'No funding'}
      </div>
    </div>
  )
}

function Breadcrumb({
  view,
  onViewChange,
  showWorld,
}: {
  view: MapView
  onViewChange: (view: MapView) => void
  showWorld: boolean
}) {
  const crumbs: Array<{ label: string; to?: MapView }> = []
  // The world tier is only offered when something can actually be painted on
  // it. Delivery geography is UK-only today, so for most portfolios a World
  // crumb would lead to a blank planet and read as a broken map.
  if (showWorld) {
    crumbs.push({ label: 'World', to: view.kind === 'world' ? undefined : { kind: 'world' } })
  }
  if (view.kind === 'country') {
    crumbs.push({ label: view.name })
  }
  if (view.kind === 'uk' || view.kind === 'region') {
    crumbs.push({
      label: 'United Kingdom',
      to: view.kind === 'uk' ? undefined : { kind: 'uk' },
    })
  }
  if (view.kind === 'region') crumbs.push({ label: view.region })

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1">
      {crumbs.map((c, i) => (
        <span key={c.label} className="flex items-center gap-1">
          {i > 0 && (
            <span className="font-display text-[12px]" style={{ color: chart.faint }}>
              ›
            </span>
          )}
          {c.to ? (
            <button
              type="button"
              onClick={() => onViewChange(c.to!)}
              className="rounded font-display text-[12px] underline-offset-2 hover:underline"
              style={{ color: chart.sub }}
            >
              {c.label}
            </button>
          ) : (
            <span className="font-display text-[12px] font-medium" style={{ color: chart.ink }}>
              {c.label}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

function Legend({ cuts, hasEmpty }: { cuts: number[]; hasEmpty: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5">
        <span className="font-display text-[11px]" style={{ color: chart.faint }}>
          Less
        </span>
        <span className="flex">
          {RAMP.map((c, i) => (
            <span
              key={c}
              title={
                cuts.length
                  ? i === 0
                    ? `up to ${fmtMoney(cuts[0]!)}`
                    : i === RAMP.length - 1
                      ? `${fmtMoney(cuts.at(-1)!)} and above`
                      : `${fmtMoney(cuts[i - 1]!)} – ${fmtMoney(cuts[i]!)}`
                  : undefined
              }
              style={{
                width: 22,
                height: 10,
                background: c,
                borderTopLeftRadius: i === 0 ? 3 : 0,
                borderBottomLeftRadius: i === 0 ? 3 : 0,
                borderTopRightRadius: i === RAMP.length - 1 ? 3 : 0,
                borderBottomRightRadius: i === RAMP.length - 1 ? 3 : 0,
              }}
            />
          ))}
        </span>
        <span className="font-display text-[11px]" style={{ color: chart.faint }}>
          More
        </span>
      </div>

      {hasEmpty && (
        <span className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, borderRadius: 3, background: EMPTY }} />
          <span className="font-display text-[11px]" style={{ color: chart.faint }}>
            No funding
          </span>
        </span>
      )}
    </div>
  )
}

/**
 * Open Government Licence attribution for the ONS boundaries. This is a licence
 * condition, not a courtesy — render it wherever the UK layers are shown.
 */
export function MapAttribution() {
  return (
    <p className="mt-2 font-display text-[10px] leading-snug" style={{ color: chart.faint }}>
      Contains OS data © Crown copyright and database right 2025. Source: ONS, licensed under the
      Open Government Licence v3.0. Country boundaries: Natural Earth.
    </p>
  )
}
