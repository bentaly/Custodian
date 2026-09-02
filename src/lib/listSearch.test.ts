import { describe, expect, it } from 'vitest'
import { parseApplicationsSearch, parseAwardsSearch, parseReportsSearch } from './listSearch'

// The property every detail screen's back arrow rests on: these parse anything and
// throw at nothing. A router that threw here would take down the screen rather than
// the filter.

describe('list search parsers', () => {
  it('carry a list position through unchanged', () => {
    const position = {
      roundId: 'r1',
      programmeId: 'p1',
      status: 'shortlisted',
      scoreBand: '80to89',
      tag: 'youth',
      q: 'trust',
      from: '2026-01-01',
      to: '2026-03-31',
      sortBy: 'score',
      sortDir: 'desc',
      page: 3,
    }
    expect(parseApplicationsSearch(position)).toEqual(position)
  })

  it('give an application opened from outside the list nothing to restore', () => {
    // The dashboard, a grant and header search all link straight to a record. The back
    // arrow then lands on the plain list, which is the behaviour that predates any of
    // this — so nothing has to know where the reader came from.
    expect(parseApplicationsSearch({})).toEqual({
      roundId: undefined,
      programmeId: undefined,
      status: undefined,
      scoreBand: undefined,
      tag: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
      sortBy: undefined,
      sortDir: undefined,
      page: undefined,
    })
  })

  it('drop what they do not recognise rather than throwing', () => {
    // A hand-edited URL, or one bookmarked before a sort key was retired.
    const got = parseApplicationsSearch({
      status: 'nonsense',
      scoreBand: 'perfect',
      sortBy: 'geography',
      sortDir: 'sideways',
      from: '31/03/2026',
      page: 'two',
      whatIsThis: 'foo',
    })
    expect(got.status).toBeUndefined()
    expect(got.scoreBand).toBeUndefined()
    expect(got.sortBy).toBeUndefined()
    expect(got.sortDir).toBeUndefined()
    expect(got.from).toBeUndefined()
    expect(got.page).toBeUndefined()
    expect('whatIsThis' in got).toBe(false)
  })

  it('treat page 1 as absent, so it round-trips to nothing', () => {
    expect(parseAwardsSearch({ page: 1 }).page).toBeUndefined()
    expect(parseAwardsSearch({ page: 2 }).page).toBe(2)
  })

  it('keep each list to its own vocabulary', () => {
    // An award is never `shortlisted`, and a report has no `status` at all — carrying a
    // foreign key across would filter the destination list to nothing.
    expect(parseAwardsSearch({ status: 'shortlisted' }).status).toBeUndefined()
    expect(parseAwardsSearch({ status: 'cancelled' }).status).toBe('cancelled')
    expect('status' in parseReportsSearch({ status: 'active' })).toBe(false)
  })

  it("leave the reports list's default tab out of the URL", () => {
    // `to_review` is the landing tab, so it has no value in the URL — a report opened
    // from it carries no `tab` back and lands on it again.
    expect(parseReportsSearch({ tab: 'to_review' }).tab).toBeUndefined()
    expect(parseReportsSearch({ tab: 'awaiting' }).tab).toBe('awaiting')
  })
})
