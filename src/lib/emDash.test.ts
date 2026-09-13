import { describe, expect, it } from 'vitest'
import { withoutEmDashes } from './emDash'

describe('withoutEmDashes', () => {
  it('turns an em dash into a spaced hyphen however it was spaced', () => {
    expect(withoutEmDashes('Strong plan — weak budget')).toBe('Strong plan - weak budget')
    expect(withoutEmDashes('Strong plan—weak budget')).toBe('Strong plan - weak budget')
  })

  it('leaves hyphens and en dashes alone', () => {
    expect(withoutEmDashes('Deciles 1–2, a well-run charity')).toBe(
      'Deciles 1–2, a well-run charity',
    )
  })

  it('reaches prose nested in objects and arrays, and passes other values through', () => {
    expect(
      withoutEmDashes({
        summary: 'Delivered — on time',
        flags: ['Late — by a month'],
        criteria: { fit: { score: 7, rationale: 'Clear — and costed' } },
        quantity: null,
      }),
    ).toEqual({
      summary: 'Delivered - on time',
      flags: ['Late - by a month'],
      criteria: { fit: { score: 7, rationale: 'Clear - and costed' } },
      quantity: null,
    })
  })
})
