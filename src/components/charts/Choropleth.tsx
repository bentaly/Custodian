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
export const UK_ISO3 = 'GBR'

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
// `aspect` is only a starting shape: the frame is fitted to the drawn content
// (see the height calculation below), so these values are what the panel
// reserves while the boundaries are still loading, and the fallback if a slice
// has no measurable extent. Roughly right stops the panel jumping as the map
// lands.
const SOURCES = {
  world: { url: '/geo/world.json', object: 'countries', key: 'code', aspect: 1.9 },
  uk: { url: '/geo/uk.json', object: 'regions', key: 'name', aspect: 0.78 },
  lad: { url: '/geo/uk-lad.json', object: 'lads', key: 'code', aspect: 1.1 },
} as const

function sourceFor(view: MapView) {
  // A zoomed country is still the world layer — the zoom is a projection fit,
  // not a different file. Nothing below country level exists outside the UK.
  if (view.kind === 'world' || view.kind === 'country') return SOURCES.world
  return view.kind === 'uk' ? SOURCES.uk : SOURCES.lad
}

/**
 * Every individual polygon across `features` whose projected area clears
 * `minArea`. Used only to decide framing — see the call site for why the split
 * to part level is load-bearing rather than tidy.
 */
function bigParts(features: GeoFeature[], path: ReturnType<typeof geoPath>, minArea: number) {
  const out: Geometry[] = []
  for (const f of features) {
    const g = f.geometry
    if (!g) continue
    const polys: Geometry[] =
      g.type === 'MultiPolygon'
        ? g.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }) as Geometry)
        : g.type === 'Polygon'
          ? [g]
          : []
    for (const poly of polys) {
      if (Math.abs(path.area(poly as Parameters<typeof path.area>[0])) >= minArea) out.push(poly)
    }
  }
  return out
}

/**
 * The tier a click on `code` opens, or null if this area is a leaf.
 *
 * Exported because the map is not the only thing you can click: the ranked list
 * beside it acts on the same areas, and a list row that merely highlighted
 * while the identical shape on the map drilled would be the panel disagreeing
 * with itself. One rule, one definition.
 *
 * `funded` gates the UK tier only. Opening an unfunded region's districts shows
 * a screen of nothing; on the world map every country stays explorable, so the
 * map does not collapse to only its funded corners.
 */
export function drillTarget(
  view: MapView,
  code: string,
  name: string,
  funded: boolean,
): MapView | null {
  if (view.kind === 'uk') return funded ? { kind: 'region', region: name } : null
  if (view.kind === 'world' || view.kind === 'country') {
    // The UK skips the country tier: it has real layers beneath it, and
    // stopping at a flat national outline would hide them.
    return code === UK_ISO3 ? { kind: 'uk' } : { kind: 'country', code, name }
  }
  // A district is the floor — nothing is mapped below LAD level.
  return null
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
        (topo) =>
          feature(topo, topo.objects[object]) as unknown as FeatureCollection<Geometry, GeoProps>,
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
const DOT_PITCH = { world: 2.5, near: 5 } as const

// Dot diameter as a fraction of the pitch. The Figma's 6-on-9 is a third, which
// is right at close range. The world tier needs a fatter dot: at a 2.5px pitch a
// third-sized dot covers so little of its cell that continents read as a grey
// wash rather than land, and the palest ramp step stops being visible at all.
const DOT_RATIO = { world: 0.42, near: 1 / 3 } as const

// How much an area recedes when a sibling is highlighted. Deliberately shallow:
// the dimmed areas are still the map, and dropping them further reads as them
// losing their funding rather than simply not being pointed at.
const DIM = 0.6
const DIM_MS = 200

function dotPitch(view: MapView) {
  return view.kind === 'world' ? DOT_PITCH.world : DOT_PITCH.near
}

function dotRadius(view: MapView) {
  return dotPitch(view) * (view.kind === 'world' ? DOT_RATIO.world : DOT_RATIO.near)
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
  highlight = null,
  onHighlight,
}: {
  view: MapView
  onViewChange: (view: MapView) => void
  /** Keyed ISO alpha-3 (world), region name (uk), or ONS LAD code (region). */
  values: Map<string, AreaDatum>
  selected: string | null
  onSelect: (key: string, name: string) => void
  /** Area to hold at full strength while everything else recedes. Driven by
   *  whichever of the map, donut or list the pointer is currently over. */
  highlight?: string | null
  onHighlight?: (key: string | null) => void
}) {
  const { data, error } = useGeo(view)
  const [hover, setHover] = useState<{ x: number; y: number; f: GeoFeature } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)

  const src = sourceFor(view)
  const width = 520
  const pitch = dotPitch(view)

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
      view.kind === 'country' ? data.features.filter((f) => f.properties.code === view.code) : feats
    if (target.length === 0) return { features: feats, pathFor: null, height: fallbackHeight }

    const targetCollection = {
      type: 'FeatureCollection',
      features: target,
    } as FeatureCollection

    // Equal-area throughout: a choropleth compares areas, and Mercator would
    // inflate Scotland and the high latitudes into a quiet lie about the data.
    const projection =
      view.kind === 'world' || view.kind === 'country'
        ? geoEqualEarth()
        : geoConicEqualArea().parallels([50, 60]).rotate([4.4, 0])

    // Frame shape, and the two views of it are opposites on purpose.
    //
    // A *zoomed country* keeps a fixed frame. Sizing it to each country's
    // bounds was the obvious move and was wrong in use: Ukraine is wide and
    // short, Bangladesh tall and narrow, so the panel lurched by hundreds of
    // pixels on every click. It costs nothing here because the surrounding
    // world is drawn too — a tall country keeps margin either side, and that
    // margin is full of its neighbours.
    //
    // Everywhere else the frame is fitted to what is actually drawn, because
    // there the margin is *empty*. A fixed aspect letterboxed the UK inside
    // whatever box we had picked, and the leftover was pure whitespace on a
    // panel with none to spare.
    //
    // The floor is not paranoia. The UK layer's bounding box is set by
    // Shetland, ~150 miles off the north coast, so measured honestly the UK is
    // 0.55 — and following that gives a map the height of a page, most of the
    // extra being empty North Sea. Clamping trades a little margin either side
    // of Britain for a panel that matches the list beside it. The ceiling is
    // the same guard the other way, for a slice that is one thin coastal
    // district.
    let fitTo = targetCollection
    let h: number
    if (view.kind === 'country') {
      h = Math.round(width / COUNTRY_ASPECT)
    } else {
      projection.fitExtent(
        [
          [0, 0],
          [width, width],
        ],
        targetCollection,
      )
      const probe = geoPath(projection)

      // Frame to the landmasses big enough to actually put dots on the screen.
      //
      // Measured honestly, the world's bounding box runs from Wallis and Futuna
      // to Fiji — Pacific specks a few pixels across. The projection fits to
      // them faithfully, and then they are far too small to catch a single
      // lattice point, so a fifth of the frame is reserved for land that never
      // renders.
      //
      // The filter has to work per *polygon*, not per country, and that is not
      // fussiness: with whole features the left edge stays pinned at the
      // Aleutian Islands, because they belong to the United States, which is
      // far too large to filter out and drags its bounds across the
      // antimeridian with it. Splitting multipolygons lets Alaska's tail go
      // while the mainland stays. Excluded parts still *draw* — they simply
      // stop getting a vote on the framing, and may be clipped at the edge.
      const big = bigParts(target, probe, (pitch * 2) ** 2)
      if (big.length > 0) {
        fitTo = { type: 'GeometryCollection', geometries: big } as unknown as FeatureCollection
      }

      const [[bx0, by0], [bx1, by1]] = probe.bounds(fitTo)
      const natural = (bx1 - bx0) / (by1 - by0)
      h = Math.round(width / Math.min(2.4, Math.max(0.72, natural || src.aspect)))
    }

    // Small: the dot lattice already inset by half a pitch, so the shape never
    // touches the edge even at zero padding.
    const pad = 4
    projection.fitExtent(
      [
        [pad, pad],
        [width - pad, h - pad],
      ],
      fitTo,
    )
    return { features: feats, pathFor: geoPath(projection), height: h }
  }, [data, view, width, src.aspect, pitch])

  const lattice = useMemo(
    () => (pathFor ? buildLattice(features, pathFor, src.key, width, height, pitch) : []),
    [features, pathFor, src.key, width, height, pitch],
  )

  const cuts = useMemo(() => thresholds([...values.values()].map((v) => v.amount)), [values])

  // Dots grouped by the colour they'll be painted, so the map is a handful of
  // compound paths. The selected area's dots are pulled into their own group at
  // a larger radius — on a dot map that reads as "this cluster" more directly
  // than any outline can, and it survives the area being unfunded, where a
  // colour change would have nothing to say.
  const layers = useMemo(() => {
    const r = dotRadius(view)
    const groups = new Map<string, { fill: string; r: number; opacity: number; dots: Dot[] }>()
    for (const dot of lattice) {
      const b = bucketOf(values.get(dot.key)?.amount ?? 0, cuts)
      if (b < 0 && dot.rescued) continue
      const isSel = selected === dot.key
      // Recede rather than disappear: a dimmed area still has to read as land,
      // or highlighting one region punches a hole in the map.
      const dim = highlight !== null && highlight !== dot.key
      const id = `${b}:${isSel}:${dim}`
      let g = groups.get(id)
      if (!g) {
        g = {
          fill: b < 0 ? EMPTY : RAMP[b]!,
          r: isSel ? r * 1.5 : r,
          opacity: dim ? DIM : 1,
          dots: [],
        }
        groups.set(id, g)
      }
      g.dots.push(dot)
    }
    // Selected last, so its larger dots are never clipped by a neighbour's.
    return [...groups.entries()]
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => Number(a.id.split(':')[1] === 'true') - Number(b.id.split(':')[1] === 'true'))
  }, [lattice, values, cuts, selected, view, highlight])

  const total = useMemo(() => [...values.values()].reduce((s, v) => s + v.amount, 0), [values])

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
  const viewKey =
    view.kind === 'country'
      ? `country:${view.code}`
      : view.kind === 'region'
        ? `region:${view.region}`
        : view.kind

  return (
    // Full height so the map can sit centred against a taller sibling column,
    // rather than hanging from the top with the imbalance pooled underneath it.
    <div className="flex h-full flex-col">
      {/* Breadcrumb and key share the top rule — where you are on the left,
          how to read it on the right. The key used to sit under the map, which
          put the one static thing on the panel at whatever height the current
          geography happened to end at. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Breadcrumb view={view} onViewChange={onViewChange} />
        <Legend cuts={cuts} hasEmpty={features.length > funded} />
      </div>

      <div
        ref={wrap}
        className="relative flex flex-1 items-center"
        onMouseLeave={() => {
          setHover(null)
          onHighlight?.(null)
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          // Not `overflow: visible` — a zoomed country fits its own bounds, so
          // its neighbours extend well past the viewBox and would otherwise
          // paint over the legend and the panel beside it.
          style={{ width: '100%', height: 'auto', display: 'block' }}
          role="img"
          aria-label={`Funding by area — ${funded} of ${features.length} areas funded, ${fmtMoney(total)} total`}
        >
          {/* A zoom is the one moment the map genuinely changes place, so it
              gets a beat: the new tier settles in rather than cutting. Held to
              a fade and a slight scale on purpose — tweening the projection
              itself would be the "real" answer and is a great deal of machinery
              for a transition most people see once. Off under reduced motion. */}
          <style>{`
            @keyframes choro-in {
              from { opacity: 0; transform: scale(0.965); }
              to   { opacity: 1; transform: scale(1); }
            }
            .choro-layer { animation: choro-in 280ms cubic-bezier(0.22, 1, 0.36, 1); }
            @media (prefers-reduced-motion: reduce) { .choro-layer { animation: none; } }
          `}</style>
          {/* The map itself.
              Re-keyed on the view so React remounts the group and the entry
              animation replays — a drill is a change of place, and without a
              beat between the two the map appears to teleport. */}
          <g
            key={viewKey}
            className="choro-layer"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          >
            {layers.map((l) => (
              <path
                key={l.id}
                d={circlesPath(l.dots, l.r)}
                fill={l.fill}
                fillOpacity={l.opacity}
                pointerEvents="none"
                style={{ transition: `fill-opacity ${DIM_MS}ms ease` }}
              />
            ))}
          </g>

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
            const drillTo = drillTarget(view, f.properties.code, f.properties.name, amount > 0)
            // Unfunded areas are inert at UK levels — there is nothing to show.
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
                  onHighlight?.(areaKey)
                }}
                onMouseLeave={() => {
                  setHover(null)
                  onHighlight?.(null)
                }}
                onFocus={() => {
                  setHover({ x: width / 2, y: 8, f })
                  onHighlight?.(areaKey)
                }}
                onBlur={() => {
                  setHover(null)
                  onHighlight?.(null)
                }}
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
            ? 'No grant in this slice has a resolved delivery location.'
            : view.kind === 'country'
              ? `No grant in this slice was delivered in ${view.name}.`
              : 'No grant in this slice resolved to an area here.'}
        </p>
      )}
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
}: {
  view: MapView
  onViewChange: (view: MapView) => void
}) {
  const crumbs: Array<{ label: string; to?: MapView }> = []
  // World is always offered, including to a purely British portfolio. Which
  // tier the map *opens* on follows the data; which tiers you may *reach* does
  // not. Hiding the crumb left a UK-only funder standing on "United Kingdom"
  // with nothing above it and no way to zoom out — and "are we only funding
  // Britain?" is a fair question for the map to be able to answer out loud.
  crumbs.push({ label: 'World', to: view.kind === 'world' ? undefined : { kind: 'world' } })
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
 * Attribution for the ONS boundaries, which is a licence condition of OGL v3
 * rather than a courtesy — so it renders wherever a UK layer is on screen and
 * cannot be dropped for being ugly.
 *
 * It is scoped to the UK tiers precisely *because* it is not optional there:
 * the world map is Natural Earth, which is public domain and explicitly asks
 * for no credit, so carrying the ONS notice under a map of Africa was three
 * lines of small print making a claim about data that wasn't on the screen.
 */
export function MapAttribution({ view }: { view: MapView }) {
  if (view.kind !== 'uk' && view.kind !== 'region') return null
  return (
    <p className="mt-2 font-display text-[10px] leading-snug" style={{ color: chart.faint }}>
      Contains OS data © Crown copyright and database right 2025. Source: ONS, licensed under the
      Open Government Licence v3.0.
    </p>
  )
}
