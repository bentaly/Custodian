import { describe, expect, it } from 'vitest'
import { SaveProgrammeSchema } from './programme'

const base = {
  name: 'Environment & Nature',
  goal: 'Ecological restoration and climate resilience.',
  tags: ['Biodiversity'],
  impactUnit: 'hectares',
  impactUnitLabel: null,
  // Present but null: the key is required, and null is what asks the server to assign
  // the first free preset rather than meaning "no colour".
  colour: null,
}

describe('SaveProgrammeSchema', () => {
  it('accepts a programme with a curated unit and no custom label', () => {
    expect(SaveProgrammeSchema.safeParse(base).success).toBe(true)
  })

  it('accepts a programme with no themes and no objectives yet', () => {
    expect(SaveProgrammeSchema.safeParse({ ...base, tags: [], goal: null }).success).toBe(true)
  })

  it('rejects "Other…" with no unit described', () => {
    // The failure this prevents is silent: `impactUnitLabel()` falls back to "People",
    // so the programme would report its impact in a unit nobody chose.
    for (const label of [null, '', '   ']) {
      const result = SaveProgrammeSchema.safeParse({
        ...base,
        impactUnit: 'other',
        impactUnitLabel: label,
      })
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.path).toEqual(['impactUnitLabel'])
    }
  })

  it('accepts "Other…" once the unit is described', () => {
    const result = SaveProgrammeSchema.safeParse({
      ...base,
      impactUnit: 'other',
      impactUnitLabel: 'hectares of peatland restored',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown impact unit', () => {
    expect(SaveProgrammeSchema.safeParse({ ...base, impactUnit: 'bananas' }).success).toBe(false)
  })

  it('treats a blank name as missing', () => {
    expect(SaveProgrammeSchema.safeParse({ ...base, name: '' }).success).toBe(false)
  })

  it('rejects a blank theme', () => {
    expect(SaveProgrammeSchema.safeParse({ ...base, tags: [''] }).success).toBe(false)
  })

  it('accepts a palette or custom colour, and rejects anything not #rrggbb', () => {
    expect(SaveProgrammeSchema.safeParse({ ...base, colour: '#37d1f7' }).success).toBe(true)
    expect(SaveProgrammeSchema.safeParse({ ...base, colour: '#123456' }).success).toBe(true)
    // Uppercase is normalised on the way IN to the schema by the picker, not by it: the
    // stored form is lowercase, so the validator holds that line.
    for (const bad of ['#37D1F7', 'red', '#abc', '37d1f7', '#1234567']) {
      expect(SaveProgrammeSchema.safeParse({ ...base, colour: bad }).success).toBe(false)
    }
  })

  it('has no `description` — the dialog collects objectives instead', () => {
    const parsed = SaveProgrammeSchema.parse({ ...base, description: 'ignored' })
    expect('description' in parsed).toBe(false)
  })
})
