// The colour a foundation gives a programme, so it is recognisable at a glance wherever
// it appears — the swatch on the programmes list, chart series, budget bars.
//
// ── How the palette was built ────────────────────────────────────────────────────────
// Ten hues 36° apart, every one at OKLCH lightness 0.76 AND chroma 0.112. Two fixed
// coordinates, one free: two colours off this ramp differ in hue and in nothing else, so
// no programme's colour shouts louder than its neighbour's — which a hand-picked set
// cannot promise. (The designer's earlier ten spanned L 0.50–0.86, so Amber was nearly
// invisible beside Purple.)
//
// Chroma used to be the free one, taken as high as each hue could reach: even in
// lightness, and 0.11 → 0.29 in colourfulness, so Magenta was three times as loud as
// Teal at identical weight. It also put the whole set well above the accent family it
// replaced (L 0.80–0.86, C 0.11–0.13), which is why programmes read as shouting at the
// pastel UI around them. Holding chroma flat costs vividness — every hue meets where the
// weakest one can reach — and that is the trade this palette deliberately takes.
//
// These are DELIBERATELY not aliases of `--color-success` / `--color-danger` /
// `--color-warning`. A programme's colour is a label a person chose; a semantic token is
// a signal the app assigns. Tying them together would mean a contrast fix to the
// semantics silently repainted somebody's programmes.
//
// ── What they may be used for ────────────────────────────────────────────────────────
// Swatches, chart series, bars — never TEXT and never a border carrying meaning on its
// own. At lightness 0.76 these sit at 2.0–2.3:1 on white, well below AA — quieter than
// the 2.7–3.4 of the max-chroma ramp, and still ahead of the `#37d1f7` sky (1.5:1) the
// dashboard was drawing programmes in before any of this.

export type ProgrammeColour = { hex: string; name: string }

/** OKLCH lightness every generated colour sits at. */
const RAMP_L = 0.76
/**
 * OKLCH chroma every generated colour sits at — how colourful it is, held flat for the
 * same reason lightness is.
 *
 * The ramp originally took the MOST chroma each hue could reach at `RAMP_L`, which made
 * the set even in lightness and wildly uneven in colourfulness: Magenta came out at
 * C 0.29 against Teal's 0.11, nearly three times as loud at identical weight. Flat
 * lightness alone is not "no programme shouts louder than its neighbour".
 *
 * 0.112 is the ceiling, and it is set by the WHOLE wheel rather than by the ten presets:
 * the tightest hue at this lightness is ~267° (blue-violet), which sits between Blue and
 * Violet, so a generated eleventh programme is exactly what would have been clipped back
 * off the ramp. Every hue has to meet where the weakest one can reach.
 *
 * Together with L 0.76 it lands near the accent family this replaced (L 0.80–0.86,
 * C 0.11–0.13) — the register the rest of the app is drawn in, and the reason the ramp
 * read as louder than everything around it.
 */
const RAMP_C = 0.112
/** Back off the gamut edge: right on it, rounding to 8-bit can clip and shift the hue. */
const RAMP_C_SAFETY = 0.92

export const PROGRAMME_PALETTE: ProgrammeColour[] = [
  { hex: '#ec92ab', name: 'Rose' },
  { hex: '#ee977c', name: 'Coral' },
  { hex: '#dba65b', name: 'Amber' },
  { hex: '#b5b75f', name: 'Olive' },
  { hex: '#81c486', name: 'Green' },
  { hex: '#4dc8b6', name: 'Teal' },
  { hex: '#4dc2e0', name: 'Sky' },
  { hex: '#7eb4f7', name: 'Blue' },
  { hex: '#b0a5f3', name: 'Violet' },
  { hex: '#d698d7', name: 'Magenta' },
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
 * A hue's place on the ramp, as a stored `#rrggbb`. Flat lightness AND flat chroma, so
 * two colours off this ramp differ in hue and nothing else. The gamut cap still applies:
 * if `RAMP_L` is ever raised, `RAMP_C` may stop being reachable at some hue, and a
 * colour that quietly left sRGB would clip to something off-ramp.
 */
export function colourForHue(hDeg: number): string {
  const h = ((hDeg % 360) + 360) % 360
  const chroma = Math.min(RAMP_C, maxChroma(RAMP_L, h) * RAMP_C_SAFETY)
  const rgb = oklchToLinearRgb(RAMP_L, chroma, h)
  return `#${rgb
    .map((v) => {
      const n = Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255)
      return Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0')
    })
    .join('')}`
}

/** A stored colour's OKLCH hue, so a custom pick can be reasoned about like a preset. */
export function hueOf(hex: string): number | null {
  const v = normaliseColour(hex)
  if (!v) return null
  const [r, g, b] = [1, 3, 5].map((i) => srgbToLinear(parseInt(v.slice(i, i + 2), 16) / 255)) as [
    number,
    number,
    number,
  ]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  // A near-grey has no meaningful hue — its angle is numerical noise.
  if (Math.hypot(A, B) < 0.01) return null
  return ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
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
 * wheel as `n` colours can be, all at the ramp's one lightness.
 *
 * This exists because the alternative is a fixed list cycled with `i % length`, which
 * hands the sixth item the first item's colour. On a budget bar the swatch is the ONLY
 * thing tying a legend row to its segment, so a repeat there is not a cosmetic loss —
 * it makes the bar unreadable at exactly the point it got interesting enough to have
 * six lines in it.
 *
 * Anchored on the first preset and stepping `360/n`, so the presets fall out of the
 * same maths: `colourSeries(10)` IS `PROGRAMME_PALETTE` (bar a rounding digit), and any
 * `n` dividing into it — 2, 5 — lands on preset hexes too. A budget of five and a
 * programme swatch are visibly the same family because they are literally the same ramp.
 *
 * Unlike `nextProgrammeColour` this takes no account of what is already in use: a series
 * is positional and thrown away with the render, where a programme's colour is an
 * identity that is stored and must not collide with its siblings'.
 */
export function colourSeries(n: number): string[] {
  if (n <= 0) return []
  const anchor = hueOf(PROGRAMME_PALETTE[0]!.hex) ?? 0
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
