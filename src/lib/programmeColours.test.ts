import { describe, expect, it } from 'vitest'
import {
  PROGRAMME_PALETTE,
  colourForHue,
  colourName,
  colourSeries,
  hueOf,
  nextProgrammeColour,
  normaliseColour,
  resolveProgrammeColour,
} from './programmeColours'

/** Shortest angle between two hues, in degrees. */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('normaliseColour', () => {
  it('lowercases, because the OS colour picker returns uppercase in some browsers', () => {
    // Stored uppercase, every `=== hex` comparison against the palette silently fails
    // and a preset renders as "Custom".
    expect(normaliseColour('#F8518E')).toBe('#f8518e')
  })

  it('expands three-digit hex', () => {
    expect(normaliseColour('#abc')).toBe('#aabbcc')
  })

  it('trims surrounding whitespace', () => {
    expect(normaliseColour('  #2ab646 ')).toBe('#2ab646')
  })

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', null, undefined, 'red', 'rgb(1,2,3)', '#12345', '#1234567', 'f8518e']) {
      expect(normaliseColour(bad)).toBeNull()
    }
  })
})

describe('the palette itself', () => {
  it('holds ten distinct, already-normalised colours', () => {
    expect(PROGRAMME_PALETTE).toHaveLength(10)
    expect(new Set(PROGRAMME_PALETTE.map((c) => c.hex)).size).toBe(10)
    for (const c of PROGRAMME_PALETTE) expect(normaliseColour(c.hex)).toBe(c.hex)
  })

  it('names every colour distinctly, and none of them "Custom"', () => {
    const names = PROGRAMME_PALETTE.map((c) => c.name)
    expect(new Set(names).size).toBe(10)
    // "Custom" is what `colourName` returns for an off-palette pick; a preset sharing
    // that name would make the two indistinguishable.
    expect(names).not.toContain('Custom')
  })

  it('spaces its hues evenly round the wheel', () => {
    // The whole point of the ramp: no two programmes sit closer together than any other
    // pair. Ten hues, 36° apart.
    const hues = PROGRAMME_PALETTE.map((c) => hueOf(c.hex)!).sort((a, b) => a - b)
    for (let i = 0; i < hues.length; i++) {
      const gap = (hues[(i + 1) % hues.length]! - hues[i]! + 360) % 360 || 360
      expect(gap).toBeGreaterThan(30)
      expect(gap).toBeLessThan(42)
    }
  })

  it('holds every colour at one lightness, which is what stops any one shouting', () => {
    // Regenerating each preset from its own recovered hue lands on the ramp — so every
    // preset IS on the ramp. (Exact hex equality is not asserted: hue recovered from an
    // 8-bit colour is not lossless, so a couple round-trip one digit out.)
    for (const c of PROGRAMME_PALETTE) {
      const regenerated = colourForHue(hueOf(c.hex)!)
      for (const i of [1, 3, 5]) {
        const a = parseInt(c.hex.slice(i, i + 2), 16)
        const b = parseInt(regenerated.slice(i, i + 2), 16)
        expect(Math.abs(a - b)).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('hueOf', () => {
  it('recovers a hue that regenerates the same colour', () => {
    expect(hueOf('#2ab646')).toBeCloseTo(hueOf(colourForHue(hueOf('#2ab646')!))!, 0)
  })

  it('is null for greys, whose hue angle is numerical noise', () => {
    for (const grey of ['#000000', '#ffffff', '#808080']) expect(hueOf(grey)).toBeNull()
  })

  it('is null for anything that is not a colour', () => {
    expect(hueOf('nonsense')).toBeNull()
  })
})

describe('colourSeries', () => {
  it('never repeats a colour, however many are asked for', () => {
    // The bug it exists to stop: a fixed list cycled with `i % length`, where the sixth
    // budget line wears the first one's colour and the bar stops keying to its legend.
    for (const n of [1, 2, 3, 5, 6, 9, 12, 24]) {
      const series = colourSeries(n)
      expect(series).toHaveLength(n)
      expect(new Set(series).size).toBe(n)
    }
  })

  it('is the palette when there are ten of them', () => {
    // Same ramp, same anchor, same 36° step — so a budget bar and a programme swatch are
    // the same family by construction rather than by two lists being kept in step.
    // (±2 per channel, as above: an 8-bit hue does not round-trip losslessly.)
    const series = colourSeries(PROGRAMME_PALETTE.length)
    series.forEach((hex, i) => {
      const preset = PROGRAMME_PALETTE[i]!.hex
      for (const j of [1, 3, 5]) {
        expect(
          Math.abs(parseInt(hex.slice(j, j + 2), 16) - parseInt(preset.slice(j, j + 2), 16)),
        ).toBeLessThanOrEqual(2)
      }
    })
  })

  it('spreads as widely as the count allows', () => {
    const hues = colourSeries(4)
      .map((c) => hueOf(c)!)
      .sort((a, b) => a - b)
    for (let i = 0; i < hues.length; i++) {
      const gap = (hues[(i + 1) % hues.length]! - hues[i]! + 360) % 360 || 360
      expect(gap).toBeCloseTo(90, 0)
    }
  })

  it('is empty for nothing to colour', () => {
    expect(colourSeries(0)).toEqual([])
    expect(colourSeries(-1)).toEqual([])
  })
})

describe('nextProgrammeColour', () => {
  it('starts at the top of the palette when nothing is taken', () => {
    expect(nextProgrammeColour([])).toBe(PROGRAMME_PALETTE[0]!.hex)
  })

  it('gives a preset far from the ones in use, not the next one along', () => {
    // The rule that matters to a foundation with three programmes. Handing them out in
    // list order gave programmes two and three neighbouring hues — 36° apart, which at
    // this ramp's chroma read as the same colour in a 12px swatch.
    const first = PROGRAMME_PALETTE[0]!.hex
    const second = nextProgrammeColour([first])
    expect(hueGap(hueOf(first)!, hueOf(second)!)).toBeGreaterThan(150)

    const third = nextProgrammeColour([first, second])
    for (const prior of [first, second]) {
      expect(hueGap(hueOf(prior)!, hueOf(third)!)).toBeGreaterThan(60)
    }
  })

  it('never repeats a preset that is already in use', () => {
    const taken = [PROGRAMME_PALETTE[0]!.hex, PROGRAMME_PALETTE[2]!.hex]
    const next = nextProgrammeColour(taken)
    expect(taken).not.toContain(next)
    expect(PROGRAMME_PALETTE.map((c) => c.hex)).toContain(next)
  })

  it('ignores nulls and casing when working out what is taken', () => {
    const next = nextProgrammeColour([null, undefined, PROGRAMME_PALETTE[0]!.hex.toUpperCase()])
    expect(next).not.toBe(PROGRAMME_PALETTE[0]!.hex)
    expect(hueGap(hueOf(PROGRAMME_PALETTE[0]!.hex)!, hueOf(next)!)).toBeGreaterThan(150)
  })

  it('keeps generating fresh, well-spaced colours past the tenth programme', () => {
    // The eleventh programme is where a fixed array runs out. Each new colour should be
    // placed in the widest remaining arc, not repeat one already on screen.
    const taken = PROGRAMME_PALETTE.map((c) => c.hex)
    for (let i = 0; i < 8; i++) {
      const next = nextProgrammeColour(taken)
      expect(taken).not.toContain(next)
      const h = hueOf(next)!
      const nearest = Math.min(...taken.map((t) => hueGap(hueOf(t)!, h)))
      // Ten presets 36° apart, bisected, leaves 18°.
      expect(nearest).toBeGreaterThan(8)
      taken.push(next)
    }
    expect(new Set(taken).size).toBe(18)
  })

  it('takes account of custom picks when choosing where the space is free', () => {
    // Walking a fixed sequence would ignore this; bisecting the real gap does not.
    // With only two colours in use, the next belongs in one of the two big arcs.
    const next = nextProgrammeColour([PROGRAMME_PALETTE[0]!.hex, PROGRAMME_PALETTE[4]!.hex])
    const h = hueOf(next)!
    expect(
      Math.min(
        hueGap(hueOf(PROGRAMME_PALETTE[0]!.hex)!, h),
        hueGap(hueOf(PROGRAMME_PALETTE[4]!.hex)!, h),
      ),
    ).toBeGreaterThan(30)
  })

  it('still returns something when every stored colour is a grey with no hue', () => {
    // `hueOf` is null for all of them, so there are no gaps to bisect.
    const greys = ['#000000', '#ffffff', '#808080']
    expect(
      normaliseColour(nextProgrammeColour([...PROGRAMME_PALETTE.map((c) => c.hex), ...greys])),
    ).not.toBeNull()
  })
})

describe('resolveProgrammeColour', () => {
  it('uses the stored colour when there is one', () => {
    expect(resolveProgrammeColour('#123456', 3)).toBe('#123456')
  })

  it('falls back to the positional colour for rows predating the column', () => {
    // These programmes were already drawn in a positional colour before `colour`
    // existed; they must keep it rather than all turning into one default.
    expect(resolveProgrammeColour(null, 0)).toBe(PROGRAMME_PALETTE[0]!.hex)
    expect(resolveProgrammeColour(null, 3)).toBe(PROGRAMME_PALETTE[3]!.hex)
  })

  it('wraps the positional fallback past the end of the palette', () => {
    expect(resolveProgrammeColour(null, PROGRAMME_PALETTE.length)).toBe(PROGRAMME_PALETTE[0]!.hex)
  })
})

describe('colourName', () => {
  it('names a preset, whatever the casing', () => {
    expect(colourName(PROGRAMME_PALETTE[0]!.hex)).toBe('Rose')
    expect(colourName(PROGRAMME_PALETTE[0]!.hex.toUpperCase())).toBe('Rose')
  })

  it('calls anything off-palette Custom', () => {
    expect(colourName('#123456')).toBe('Custom')
  })

  it('is null when there is no colour at all', () => {
    expect(colourName(null)).toBeNull()
  })
})
