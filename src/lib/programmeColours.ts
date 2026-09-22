// The colour a foundation gives a programme, so it is recognisable at a glance wherever
// it appears — the swatch on the programmes list, chart series, budget bars.
//
// ── How the palette was built ────────────────────────────────────────────────────────
// Ten hues evenly spaced round the wheel, each taking the lightness and chroma a curve
// through the four ORIGINAL colours from the Figma design gives it. Those four are stated below;
// every other hue is generated on the curve between them, so the eleventh programme and
// the fortieth have an answer the hand-picked set never had.
//
// Two rules were tried before this, and both flattened the set to one lightness: first
// with chroma taken to the gamut edge at every hue (even in weight, 0.11 → 0.29 in
// colourfulness, so Magenta was three times as loud as Teal), then with chroma held flat
// too. Flat chroma has to be set by the tightest hue on the whole wheel. Flat LIGHTNESS
// is what made the warm half mud: a gold is a pale colour, and a gold with the lightness
// taken out of it is not a deeper gold, it is a brown. No rotation escapes that — ten
// hues go all the way round, so something always lands in the gold-to-olive quarter.
//
// The designer's own four never sat on one lightness: their gold is at 0.86 and their
// violet at 0.64. That spread is most of what people recognise as the original palette.
//
// The cost, stated plainly: this set is NOT even in weight. Some colours are lighter than
// others, which is the thing flat lightness existed to prevent, and it is a trade taken
// deliberately rather than an oversight.
//
// These are DELIBERATELY not aliases of `--color-success` / `--color-danger` /
// `--color-warning`. A programme's colour is a label a person chose; a semantic token is
// a signal the app assigns. Tying them together would mean a contrast fix to the
// semantics silently repainted somebody's programmes.
//
// ── What they may be used for ────────────────────────────────────────────────────────
// Swatches, chart series, bars — never TEXT and never a border carrying meaning on its
// own. These run 1.5–3.5:1 on white, every one below AA, and the spread is wider than the
// flat ramps before them precisely because lightness is free again.

export type ProgrammeColour = { hex: string; name: string }

/**
 * The four programme colours from Custodian's original Figma design, which are what this
 * ramp is now built out of. Measured, they sit nowhere near one lightness: the gold is at 0.86 and the
 * violet at 0.64, because a gold is only a gold while it is pale and a violet is only a
 * violet while it is deep. Holding all ten at one lightness is what turned the warm half
 * to mud, and no rotation of the wheel escapes it — ten hues go all the way round, so
 * something always lands in the gold-to-olive quarter.
 */
const ORIGINAL_ANCHORS = ['#fdc86f', '#37d1f7', '#7a7bef', '#f7a1c4'] as const
/** Back off the gamut edge: right on it, rounding to 8-bit can clip and shift the hue. */
const RAMP_C_SAFETY = 0.92

type Anchor = { L: number; C: number; h: number }

/**
 * The anchors as coordinates, in hue order, so the curve below can run through them.
 * Resolved on first use rather than at module load: `oklchOf` leans on the sRGB helpers
 * further down the file, and a `const` arrow is not hoisted the way a function is.
 */
let anchorCache: { pts: Anchor[]; L: [number, number]; C: [number, number] } | null = null
function anchors() {
  if (!anchorCache) {
    const pts = ORIGINAL_ANCHORS.map(oklchOf).sort((a, b) => a.h - b.h)
    const at = (key: 'L' | 'C') =>
      [Math.min(...pts.map((p) => p[key])), Math.max(...pts.map((p) => p[key]))] as [number, number]
    anchorCache = { pts, L: at('L'), C: at('C') }
  }
  return anchorCache
}

/**
 * Lightness (or chroma) at a hue, on a loop that passes exactly through all four anchors.
 *
 * A Catmull-Rom segment between the two anchors either side, with the next one out at
 * each end setting the slope, so the loop is smooth where it crosses an anchor rather
 * than kinked. Clamped to the anchors' own range because a cubic overshoots on an uneven
 * spacing like this one, and an overshoot is a colour paler or weaker than anything the
 * designer picked.
 */
function curveAt(key: 'L' | 'C', hDeg: number): number {
  const { pts, L, C } = anchors()
  const n = pts.length
  const h = ((hDeg % 360) + 360) % 360
  let i = 0
  for (let k = 0; k < n; k++) {
    const span = (pts[(k + 1) % n]!.h - pts[k]!.h + 360) % 360
    if ((h - pts[k]!.h + 360) % 360 <= span + 1e-9) {
      i = k
      break
    }
  }
  const a = pts[i]!
  const b = pts[(i + 1) % n]!
  const p0 = pts[(i - 1 + n) % n]!
  const p3 = pts[(i + 2) % n]!
  const span = (b.h - a.h + 360) % 360 || 360
  const t = ((h - a.h + 360) % 360) / span
  const [v0, v1, v2, v3] = [p0[key], a[key], b[key], p3[key]]
  const v =
    0.5 *
    (2 * v1 +
      (-v0 + v2) * t +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t * t +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t * t * t)
  const [lo, hi] = key === 'L' ? L : C
  return Math.min(hi, Math.max(lo, v))
}

/**
 * The ten, generated by `colourForHue` at 36° steps from the Sky anchor's own hue. Sky is
 * the one that lands on an anchor exactly; the others fall between anchors, on the curve,
 * because the four originals are not 36° apart and an even ten cannot hit all four.
 *
 * Sky comes first because the first preset is what a foundation's first programme is
 * given (`nextProgrammeColour`, with nothing taken). Budget lines and other generated
 * series do NOT start here — see `colourSeries`.
 */
export const PROGRAMME_PALETTE: ProgrammeColour[] = [
  { hex: '#37d1f7', name: 'Sky' },
  { hex: '#519bf7', name: 'Blue' },
  { hex: '#9077ea', name: 'Violet' },
  { hex: '#d58cd5', name: 'Magenta' },
  { hex: '#fba7bc', name: 'Blush' },
  { hex: '#fbbda8', name: 'Coral' },
  { hex: '#fcc87f', name: 'Amber' },
  { hex: '#d4d873', name: 'Lime' },
  { hex: '#93e39b', name: 'Green' },
  { hex: '#4ae1cd', name: 'Teal' },
]

export const PROGRAMME_COLOUR_PATTERN = /^#[0-9a-f]{6}$/

/**
 * Anything the colour input can produce, reduced to the one form we store: a lowercase
 * six-digit hex. `<input type="color">` returns uppercase in some browsers, and a hand-
 * typed `#ABC` is a valid CSS colour that would never match a palette entry.
 */
export function normaliseColour(value: string | null | undefined): string | null {
  if (!value) return null
  const v = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  return PROGRAMME_COLOUR_PATTERN.test(v) ? v : null
}

export function colourName(hex: string | null | undefined): string | null {
  const v = normaliseColour(hex)
  return v ? (PROGRAMME_PALETTE.find((c) => c.hex === v)?.name ?? 'Custom') : null
}

// ── OKLCH ⇄ sRGB ─────────────────────────────────────────────────────────────────────
// Enough of the colour space to place a new hue on the ramp. Kept here rather than
// pulled in as a dependency: it is thirty lines, and the palette above was generated
// with exactly this maths, so the presets and anything generated later are one family.

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function oklchToLinearRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (L: number, C: number, h: number) =>
  oklchToLinearRgb(L, C, h).every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** Largest chroma that still fits in sRGB at this lightness and hue. */
function maxChroma(L: number, h: number): number {
  let lo = 0
  let hi = 0.45
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(L, mid, h)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * A hue's place on the ramp, as a stored `#rrggbb`. Lightness and chroma both come off
 * the curve through the four originals, so a colour is as light as that hue wants to be
 * rather than as light as every other hue can manage. The gamut cap still applies: the
 * curve asks for more chroma than sRGB has at some hues, and a colour that quietly left
 * the gamut would clip to something off-ramp.
 */
export function colourForHue(hDeg: number): string {
  const h = ((hDeg % 360) + 360) % 360
  const lightness = curveAt('L', h)
  const chroma = Math.min(curveAt('C', h), maxChroma(lightness, h) * RAMP_C_SAFETY)
  const rgb = oklchToLinearRgb(lightness, chroma, h)
  return `#${rgb
    .map((v) => {
      const n = Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255)
      return Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0')
    })
    .join('')}`
}

/** A `#rrggbb` as OKLCH coordinates. Assumes an already-normalised six-digit hex. */
function oklchOf(hex: string): { L: number; C: number; h: number } {
  const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    C: Math.hypot(A, B),
    h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  }
}

/** A stored colour's OKLCH hue, so a custom pick can be reasoned about like a preset. */
export function hueOf(hex: string): number | null {
  const v = normaliseColour(hex)
  if (!v) return null
  const { C, h } = oklchOf(v)
  // A near-grey has no meaningful hue — its angle is numerical noise.
  return C < 0.01 ? null : h
}

/** Angular distance between two hues, the short way round the wheel. */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * The colour to give a new programme: the one FURTHEST from the colours already in use.
 *
 * Presets are preferred while any are free — they are the ten that were designed, and
 * they carry names the picker can show — but the choice among them is by distance, not
 * by list order. Order was the original rule and it put every foundation's first few
 * programmes in a warm cluster: programmes two and three got Coral and Amber, hues 36°
 * apart, which at this ramp's chroma are hard to tell apart in a 12px swatch. Ten hues
 * 36° apart are all distinguishable as a SET; consecutive ones are not, and a foundation
 * with four programmes only ever sees four of them.
 *
 * Past the tenth, a new colour is placed in the middle of the largest gap between the
 * hues in use — the same idea, freed from the preset list. Bisecting the real gap rather
 * than walking a fixed sequence (a golden angle, say) is what makes this work with the
 * custom picker: someone who chooses their own colour changes where the space is free,
 * and the next colour takes account of it.
 */
export function nextProgrammeColour(taken: Iterable<string | null | undefined>): string {
  const used = [...taken].map(normaliseColour).filter((c): c is string => c !== null)
  const usedSet = new Set(used)

  const free = PROGRAMME_PALETTE.filter((c) => !usedSet.has(c.hex))
  if (free.length > 0) {
    const usedHues = used.map(hueOf).filter((h): h is number => h !== null)
    // Nothing in use with a readable hue (a first programme, or only greys taken): the
    // designed order is as good an answer as any, and starts where the palette starts.
    if (usedHues.length === 0) return free[0]!.hex
    let best = free[0]!
    let bestGap = -1
    for (const c of free) {
      const h = hueOf(c.hex)
      if (h === null) continue
      const gap = Math.min(...usedHues.map((u) => hueDistance(h, u)))
      if (gap > bestGap) {
        bestGap = gap
        best = c
      }
    }
    return best.hex
  }

  const hues = used
    .map(hueOf)
    .filter((h): h is number => h !== null)
    .sort((a, b) => a - b)
  if (hues.length === 0) return PROGRAMME_PALETTE[0]!.hex

  // Widest arc between neighbours, wrapping past 360.
  let bestStart = hues[0]!
  let bestGap = -1
  for (let i = 0; i < hues.length; i++) {
    const start = hues[i]!
    const gap = (hues[(i + 1) % hues.length]! - start + 360) % 360 || 360
    if (gap > bestGap) {
      bestGap = gap
      bestStart = start
    }
  }
  return colourForHue(bestStart + bestGap / 2)
}

/**
 * `n` colours for an ad-hoc series — budget lines, chart segments — as far apart on the
 * wheel as `n` colours can be, each at the lightness the curve gives its hue.
 *
 * This exists because the alternative is a fixed list cycled with `i % length`, which
 * hands the sixth item the first item's colour. On a budget bar the swatch is the ONLY
 * thing tying a legend row to its segment, so a repeat there is not a cosmetic loss —
 * it makes the bar unreadable at exactly the point it got interesting enough to have
 * six lines in it.
 *
 * Same curve as the presets, different starting point: a series opens on the ORIGINAL
 * Amber, where programmes open on Sky. The two jobs want different first colours — a
 * foundation's first programme and an application's first budget line are not the same
 * kind of thing, and the budget line should not look like it belongs to a programme.
 *
 * Starting elsewhere does not keep a series off the programme colours, and nothing
 * could: presets sit every 36° all the way round, so every hue is within 18° of one, and
 * for three to eight lines the best possible start still leaves some 5–9° from a preset.
 * Accepted — a budget bar and a programme swatch sharing a hue is a mild coincidence,
 * not a misreading, since the two never appear as one legend.
 *
 * Unlike `nextProgrammeColour` this takes no account of what is already in use: a series
 * is positional and thrown away with the render, where a programme's colour is an
 * identity that is stored and must not collide with its siblings'.
 */
export function colourSeries(n: number): string[] {
  if (n <= 0) return []
  const anchor = oklchOf(ORIGINAL_ANCHORS[0]).h
  return Array.from({ length: n }, (_, i) => colourForHue(anchor + (i * 360) / n))
}

/**
 * A programme's colour for display. `index` is its position in the list, used only for
 * programmes created before the column existed — they keep the positional colour the
 * screen already showed them in, rather than all turning grey until someone edits them.
 */
export function resolveProgrammeColour(colour: string | null | undefined, index: number): string {
  return normaliseColour(colour) ?? PROGRAMME_PALETTE[index % PROGRAMME_PALETTE.length]!.hex
}
