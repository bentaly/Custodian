import { describe, expect, it } from 'vitest'
import { autoMappingsFor } from './provenance'

// The queue offers a "lookup" tick beside every mapped field. These are the cases where
// that offer is redundant — the field already maps itself — and ticking it would write a
// per-client row that changes nothing while implying the field had needed teaching.

describe('autoMappingsFor', () => {
  const none = new Map<string, string>()

  it('resolves a payload key sent under its canonical name', () => {
    expect(autoMappingsFor(['programmeName'], none)).toEqual({
      programmeName: { canonicalField: 'programmeName', via: 'identity' },
    })
  })

  it('resolves a name the built-in dictionary already knows, for every foundation', () => {
    // Arete's form sends this verbatim; a per-client lookup would shadow a global rule.
    expect(
      autoMappingsFor(['Charity/Organisation Name'], none)['Charity/Organisation Name'],
    ).toEqual({ canonicalField: 'organisationName', via: 'dictionary' })
  })

  it("resolves a name already in this foundation's table", () => {
    const learned = new Map([['Contact Email', 'applicantEmail']])
    expect(autoMappingsFor(['Contact Email'], learned)['Contact Email']).toEqual({
      canonicalField: 'applicantEmail',
      via: 'lookup',
    })
  })

  it('reports nothing for a name only the AI or a human could place', () => {
    // The one case the tick is FOR: without it this maps by AI every time, or not at all.
    expect(autoMappingsFor(['How will our funding be directed?'], none)).toEqual({})
  })

  it("lets a foundation's own table win over the dictionary, as the pipeline does", () => {
    // Reporting the dictionary's answer here would make the badge a lie in exactly the
    // case that matters: a foundation that has deliberately overridden an alias.
    const override = new Map([['Charity Number', 'companyNumber']])
    expect(autoMappingsFor(['Charity Number'], override)['Charity Number']).toEqual({
      canonicalField: 'companyNumber',
      via: 'lookup',
    })
  })

  it('ignores a stored mapping pointing at a field that no longer exists', () => {
    const stale = new Map([['Some Field', 'retiredCanonicalField']])
    expect(autoMappingsFor(['Some Field'], stale)).toEqual({})
  })
})
