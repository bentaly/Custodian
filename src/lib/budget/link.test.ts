import { describe, it, expect } from 'vitest'
import { budgetDocumentName } from './link'

describe('budgetDocumentName', () => {
  it('reads the filename from a storage URL', () => {
    expect(
      budgetDocumentName(
        'https://api.typeform.com/responses/files/fb3ca027d753/Project_Budget.ods',
      ),
    ).toBe('Project_Budget.ods')
  })

  it('decodes percent-escaped filenames', () => {
    expect(budgetDocumentName('https://example.org/files/Project%20Budget%202026.xlsx')).toBe(
      'Project Budget 2026.xlsx',
    )
  })

  it('ignores a query string', () => {
    expect(budgetDocumentName('https://example.org/f/budget.xlsx?token=abc&x=1')).toBe(
      'budget.xlsx',
    )
  })

  const fallbacks: Array<[string, string]> = [
    ['a bare host', 'https://example.org'],
    ['a trailing slash', 'https://example.org/files/'],
    // An id with no extension is not a filename — printing a hash at an admin is worse
    // than printing a plain label.
    ['an extensionless id', 'https://example.org/files/fb3ca027d753eeca3d05c555bdd7679c'],
    ['a non-URL', 'not a url at all'],
  ]
  for (const [name, url] of fallbacks) {
    it(`falls back to a plain label for ${name}`, () => {
      expect(budgetDocumentName(url)).toBe('Budget document')
    })
  }

  it('truncates a filename long enough to stop being a label', () => {
    const long = `${'a'.repeat(120)}.xlsx`
    const out = budgetDocumentName(`https://example.org/${long}`)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('…')).toBe(true)
  })
})
