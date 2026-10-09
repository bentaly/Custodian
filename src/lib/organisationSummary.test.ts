import { describe, expect, it } from 'vitest'
import { SUMMARY_PREVIEW_CHARS, summaryPreview } from './organisationSummary'

describe('summaryPreview', () => {
  it('says nothing for an absent or blank description', () => {
    expect(summaryPreview(null)).toBeNull()
    expect(summaryPreview('  \n ')).toBeNull()
  })

  it('collapses a form answer’s line breaks', () => {
    expect(summaryPreview('We run a youth club.\n\nOpen five nights.')).toBe(
      'We run a youth club. Open five nights.',
    )
  })

  it('keeps a short description whole', () => {
    const text = 'a'.repeat(SUMMARY_PREVIEW_CHARS)
    expect(summaryPreview(text)).toBe(text)
  })

  it('cuts a long one at a word, with an ellipsis', () => {
    // What the server sends for a long answer: the preview plus one character.
    const text = 'word '.repeat(80).slice(0, SUMMARY_PREVIEW_CHARS + 1)
    const out = summaryPreview(text)!
    expect(out.endsWith('word…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(SUMMARY_PREVIEW_CHARS + 1)
  })
})
