// The colour a foundation gives a programme, so it is recognisable at a glance wherever
// it appears — the swatch on the programmes list, chart series, budget bars.
//
// ── How the palette was built ────────────────────────────────────────────────────────
// Ten hues 36° apart, every one at OKLCH lightness 0.68, each pushed as saturated as it
// can go at that hue without leaving sRGB. Fixed lightness is the point: it means no
// programme's colour shouts louder than its neighbour's, which a hand-picked set cannot
// promise. (The designer's earlier ten spanned 0.50–0.86, so Amber was nearly invisible
// beside Purple.) Chroma is allowed to vary because holding it fixed too would cap every
// colour at whatever the weakest hue allows, and the whole set goes muddy.
//
// These are DELIBERATELY not aliases of `--color-success` / `--color-danger` /
// `--color-warning`. A programme's colour is a label a person chose; a semantic token is
// a signal the app assigns. Tying them together would mean a contrast fix to the
// semantics silently repainted somebody's programmes.
//
// ── What they may be used for ────────────────────────────────────────────────────────
// Swatches, chart series, bars — never TEXT and never a border carrying meaning on its
// own. At lightness 0.68 these sit at 2.7–3.4:1 on white, which is below AA.

export type ProgrammeColour = { hex: string; name: string }

/** OKLCH lightness every generated colour sits at. */
const RAMP_L = 0.68
/** Back off the gamut edge: right on it, rounding to 8-bit can clip and shift the hue. */
const RAMP_C_SAFETY = 0.92

export const PROGRAMME_PALETTE: ProgrammeColour[] = [
  { hex: '#f8518e', name: 'Rose' },
  { hex: '#f8612d', name: 'Coral' },
  { hex: '#c88a24', name: 'Amber' },
  { hex: '#9e9f25', name: 'Olive' },
  { hex: '#2ab646', name: 'Green' },
  { hex: '#2baf9d', name: 'Teal' },
  { hex: '#2aa8c6', name: 'Sky' },
  { hex: '#4a9af7', name: 'Blue' },
  { hex: '#9982f7', name: 'Violet' },
  { hex: '#eb2ff5', name: 'Magenta' },
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

/** A hue's place on the ramp, as a stored `#rrggbb`. */
export function colourForHue(hDeg: number): string {
  const h = ((hDeg % 360) + 360) % 360
  const rgb = oklchToLinearRgb(RAMP_L, maxChroma(RAMP_L, h) * RAMP_C_SAFETY, h)
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

/**
 * The colour to give a new programme.
 *
 * Presets first, in order, so the common case (a foundation with a handful of
 * programmes) gets the set that was designed — ten hues at their widest possible
 * spacing. Past ten, a new colour is placed in the MIDDLE OF THE LARGEST GAP between the
 * hues already in use, so it is as far from every existing colour as the wheel allows.
 *
 * Bisecting the real gap rather than walking a fixed sequence (a golden angle, say) is
 * what makes this work with the custom picker: someone who chooses their own colour
 * changes where the space is free, and the next generated colour takes account of it.
 */
export function nextProgrammeColour(taken: Iterable<string | null | undefined>): string {
  const used = [...taken].map(normaliseColour).filter((c): c is string => c !== null)
  const usedSet = new Set(used)

  const free = PROGRAMME_PALETTE.find((c) => !usedSet.has(c.hex))
  if (free) return free.hex

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
 * A programme's colour for display. `index` is its position in the list, used only for
 * programmes created before the column existed — they keep the positional colour the
 * screen already showed them in, rather than all turning grey until someone edits them.
 */
export function resolveProgrammeColour(colour: string | null | undefined, index: number): string {
  return normaliseColour(colour) ?? PROGRAMME_PALETTE[index % PROGRAMME_PALETTE.length]!.hex
}
