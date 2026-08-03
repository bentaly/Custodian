import { useEffect, useMemo, useRef, useState } from 'react'
import { geoConicEqualArea, geoEqualEarth, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { chart, fmtMoney, tooltipBox } from './theme'

// Choropleth — "where the money went", drawn as the Figma's dot matrix.
//
// Deliberately not a map library. There is no basemap, no tile server and no
// API key: we own every mark on the screen and style it with the same tokens as
// every other chart, which is why it can match the Figma instead of fighting
// someone else's cartography. Boundaries are built by `pnpm geo:build` into
// public/geo — see scripts/build-geo.ts.
//
// Nothing here paints a country. The boundaries are used twice — once to decide
// which area each dot in a global lattice belongs to (see "Dot lattice"), and
// once as an invisible hit layer so the whole area stays hoverable. Between
// those two the shapes are never filled or stroked.
//
// Scale note: SVG hit-testing starts to feel sticky somewhere north of ~2,000
// paths. The hit layer is the only per-area path left — the world at 240, the
// busiest UK view at 361 LADs — so we are an order of magnitude clear. Going
// below LAD level nationally (LSOAs are ~35k) would mean canvas instead.

// ─── Sequential ramp ────────────────────────────────────────────────────────────
// Magnitude, so: one hue, five steps, light→dark, stepped in OKLab off the brand
// green. Validated as an ordinal ramp (monotone lightness, adjacent ΔL ≥ 0.06,
// light end ≥ 2:1 on white, single hue — spread is 1°). Do not hand-tweak a step
// without re-running that check; the light end in particular sits deliberately
// close to its 2:1 floor and a "nicer" paler green would disappear on the panel.
const RAMP = ['#87B5A1', '#69A089', '#4B8B71', '#29765B', '#006145'] as const

// Areas with no grants. Distinct from — and lighter than — every ramp step, so
// "we funded nothing here" can never be misread as "we funded a little here".
//
// This is heavier than the gray a filled choropleth would use, and taken
// straight from the Figma. A dot covers a fraction of the ink a filled region
// does, so a colour that reads as "a quiet backdrop" at region size reads as
// "nothing rendered" at 5px. The land has to stay visible for the funded dots
// to have a shape to sit in.
const EMPTY = '#BCD8CF'

// The one country with a layer beneath it, so it is the one country on the
// world map that drills rather than selects.
const UK_ISO3 = 'GBR'

// Frame shape for a zoomed country. Slightly landscape: it suits the majority
// of countries and sits close enough to the UK view's 1.15 that switching
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
//
// The UK frames are deliberately wider than the UK itself. Matching Britain's
// true 0.78 portrait proportion gives a technically perfect fit and a panel
// two-thirds again as tall as the charts beside it, which dominates the screen
// and pushes everything below it off the fold. Sizing them near-square costs
// some margin either side of Scotland and buys back ~200px of page.
const SOURCES = {
  world: { url: '/geo/world.json', object: 'countries', key: 'code', aspect: 1.9 },
  uk: { url: '/geo/uk.json', object: 'regions', key: 'name', aspect: 1.15 },
  lad: { url: '/geo/uk-lad.json', object: 'lads', key: 'code', aspect: 1.15 },
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

// ─── Dot lattice ────────────────────────────────────────────────────────────────
// The map is drawn as a halftone grid rather than filled shapes, per the Figma.
//
// The effect only holds if the lattice is *global* — one grid laid across the
// whole frame, every dot taking the colour of whichever area it lands in. Dots
// laid out per-country instead would fall out of step at every border and the
// grid would break into visible seams. This is also why an SVG <pattern> fill
// won't do it: a pattern clips to its shape, so every coastline would be a line
// of half-dots, and the design's dots are whole.
//
// Sized from the Figma's ratio — a 6px dot on a 9px pitch, so the dot is a
// third of the step — but the pitch itself has to vary, because that frame
// holds one continent and ours has to hold anything from the planet to a
// London borough. The whole world at the Figma's pitch turns Britain into two
// dots; a single region at the world's pitch is a needlessly fussy stipple.
const DOT_PITCH = { world: 4, near: 6 } as const
const DOT_RATIO = 1 / 3

function dotPitch(view: MapView) {
  return view.kind === 'world' ? DOT_PITCH.world : DOT_PITCH.near
}

/** `rescued` marks a dot the grid never actually hit — see `buildLattice`. */
type Dot = { x: number; y: number; key: string; rescued?: true }

/**
 * Which area each lattice point falls in.
 *
 * Answered by hit-testing the *projected* path on a throwaway canvas rather
 * than inverting the projection and asking `geoContains`: it works in the same
 * coordinate space as what we draw (so no antimeridian or out-of-domain
 * special cases), and `isPointInPath` is native code. The bounding-box test in
 * front of it is what makes this cheap — it rejects all but a couple of
 * candidate areas per point with plain number comparisons, turning ~700k
 * possible tests into a few thousand real ones.
 *
 * Depends only on geometry, never on the values, so re-colouring the map when a
 * filter changes doesn't rebuild it.
 */
function buildLattice(
  features: GeoFeature[],
  pathFor: ReturnType<typeof geoPath>,
  key: 'code' | 'name',
  width: number,
  height: number,
  pitch: number,
): Dot[] {
  if (typeof document === 'undefined') return []
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return []

  const shapes = []
  for (const f of features) {
    const d = pathFor(f)
    if (d) {
      shapes.push({
        key: keyOf(f, key),
        bounds: pathFor.bounds(f),
        centroid: pathFor.centroid(f),
        path: new Path2D(d),
        hit: false,
      })
    }
  }

  const dots: Dot[] = []
  for (let y = pitch / 2; y < height; y += pitch) {
    for (let x = pitch / 2; x < width; x += pitch) {
      for (const s of shapes) {
        const [[x0, y0], [x1, y1]] = s.bounds
        if (x < x0 || x > x1 || y < y0 || y > y1) continue
        if (!ctx.isPointInPath(s.path, x, y)) continue
        dots.push({ x, y, key: s.key })
        s.hit = true
        break
      }
    }
  }

  // An area smaller than the pitch catches no lattice point and would vanish
  // entirely — and on a map about where the money went, a *funded* area that
  // renders as nothing is the one failure that matters. So anything the grid
  // missed gets a single dot at its centroid, and is marked `rescued`.
  //
  // Marked rather than filtered here because that call needs the values, and
  // the lattice deliberately doesn't know them — the caller drops rescued dots
  // for unfunded areas. Keeping them all would stipple the Pacific with
  // one-dot island nations, which reads as dirt on the screen rather than data.
  for (const s of shapes) {
    const [x, y] = s.centroid
    if (s.hit || !Number.isFinite(x) || !Number.isFinite(y)) continue
    dots.push({ x, y, key: s.key, rescued: true })
  }

  return dots
}

/**
 * Many circles as one path string. Grouping dots by colour into a handful of
 * compound paths keeps the map at a few DOM nodes instead of a few thousand
 * `<circle>`s, which is what stops a filter change from janking.
 */
function circlesPath(dots: Dot[], r: number) {
  const d2 = r * 2
  let d = ''
  for (const p of dots) {
    d += `M${(p.x - r).toFixed(1)} ${p.y.toFixed(1)}a${r} ${r} 0 1 0 ${d2} 0a${r} ${r} 0 1 0 ${-d2} 0`
  }
  return d
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

  const pitch = dotPitch(view)
  const lattice = useMemo(
    () => (pathFor ? buildLattice(features, pathFor, src.key, width, height, pitch) : []),
    [features, pathFor, src.key, width, height, pitch],
  )

  const cuts = useMemo(
    () => thresholds([...values.values()].map((v) => v.amount)),
    [values],
  )

  // Dots grouped by the colour they'll be painted, so the map is a handful of
  // compound paths. The selected area's dots are pulled into their own group at
  // a larger radius — on a dot map that reads as "this cluster" more directly
  // than any outline can, and it survives the area being unfunded, where a
  // colour change would have nothing to say.
  const layers = useMemo(() => {
    const r = pitch * DOT_RATIO
    const groups = new Map<string, { fill: string; r: number; dots: Dot[] }>()
    for (const dot of lattice) {
      const b = bucketOf(values.get(dot.key)?.amount ?? 0, cuts)
      if (b < 0 && dot.rescued) continue
      const isSel = selected === dot.key
      const id = `${b}:${isSel}`
      let g = groups.get(id)
      if (!g) {
        g = { fill: b < 0 ? EMPTY : RAMP[b]!, r: isSel ? r * 1.5 : r, dots: [] }
        groups.set(id, g)
      }
      g.dots.push(dot)
    }
    // Selected last, so its larger dots are never clipped by a neighbour's.
    return [...groups.entries()]
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => Number(a.id.endsWith('true')) - Number(b.id.endsWith('true')))
  }, [lattice, values, cuts, selected, pitch])

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
          {/* The map itself. */}
          {layers.map((l) => (
            <path key={l.id} d={circlesPath(l.dots, l.r)} fill={l.fill} pointerEvents="none" />
          ))}

          {/* Interaction and accessibility, on the real boundaries but invisible.
              Dots are far too small and too many to be hit targets themselves,
              and hovering the gaps between them would strobe the tooltip — so
              the whole area stays hoverable exactly as it was when it was
              filled. `pointerEvents="all"` is what makes an unpainted path
              catch the mouse. */}
          {features.map((f) => {
            const d = pathFor(f)
            if (!d) return null
            const areaKey = keyOf(f, src.key)
            const datum = values.get(areaKey)
            const amount = datum?.amount ?? 0
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
                fill="none"
                pointerEvents="all"
                style={{ cursor: interactive ? 'pointer' : 'default', outline: 'none' }}
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
