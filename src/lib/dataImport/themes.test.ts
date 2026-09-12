import { describe, it, expect } from 'vitest'
import { splitThemes } from './parse'
import { resolveColumn } from './match'
import {
  grantThemes,
  resolveThemeValues,
  themeCandidates,
  themeMismatchIssues,
  type ProgrammeWithThemes,
} from './themes'

const PROGRAMMES: ProgrammeWithThemes[] = [
  { id: 'p-young', name: 'Young People', tags: ['Youth', 'Mental health', 'Employment'] },
  { id: 'p-env', name: 'Environment', tags: ['Rewilding', 'Youth'] },
  { id: 'p-none', name: 'Core', tags: null },
]

describe('splitThemes', () => {
  it('splits on semicolons and line breaks, trimming each', () => {
    expect(splitThemes(' Youth ;Mental health\nEmployment ')).toEqual([
      'Youth',
      'Mental health',
      'Employment',
    ])
  })

  // A theme name can contain a comma; splitting on it would turn one theme into two.
  it('does not split on commas', () => {
    expect(splitThemes('Arts, culture and heritage; Youth')).toEqual([
      'Arts, culture and heritage',
      'Youth',
    ])
  })

  it('collapses a value typed twice, and reads a blank cell as no values', () => {
    expect(splitThemes('Youth; youth;;')).toEqual(['Youth'])
    expect(splitThemes('   ')).toEqual([])
    expect(splitThemes(null)).toEqual([])
  })
})

describe('themeCandidates', () => {
  it('offers each theme once across programmes', () => {
    expect(themeCandidates(PROGRAMMES).map((c) => c.name)).toEqual([
      'Employment',
      'Mental health',
      'Rewilding',
      'Youth',
    ])
  })
})

describe('resolveThemeValues', () => {
  it('settles an exact match silently and proposes a near one', () => {
    const [yuoth, mental] = resolveThemeValues(
      [{ themes: ['mental health', 'Yuoth'] }, { themes: ['Yuoth'] }],
      PROGRAMMES,
    )
    expect(yuoth).toMatchObject({ value: 'Yuoth', rowCount: 2 })
    expect(mental?.match.kind).toBe('exact')
  })
})

describe('themeMismatchIssues', () => {
  const grants = [
    { rowNumber: 2, programme: 'Young People', themes: ['Youth'] },
    { rowNumber: 3, programme: 'Young People', themes: ['Rewilding'] },
    // A suggestion is a human's decision still to make — checked at commit, not here.
    { rowNumber: 4, programme: 'Young People', themes: ['Rewildng'] },
  ]
  const issues = () =>
    themeMismatchIssues(
      grants,
      PROGRAMMES,
      resolveColumn(
        grants.map((g) => g.programme),
        PROGRAMMES,
      ),
      resolveThemeValues(grants, PROGRAMMES),
    )

  it('blocks a real theme that belongs to a different programme', () => {
    const [issue] = issues()
    expect(issue).toMatchObject({ kind: 'blocker', code: 'theme_not_in_programme', rows: [3] })
    expect(issue?.detail).toContain('“Rewilding” is not one of Young People’s themes')
  })
})

describe('grantThemes', () => {
  const youngPeople = PROGRAMMES[0]!.tags

  it('gives a blank cell every theme its programme has', () => {
    expect(grantThemes({ themes: [] }, youngPeople, {}).themes).toEqual(youngPeople)
  })

  it('keeps the chosen themes in the programme’s own order and spelling', () => {
    const result = grantThemes({ themes: ['employment', 'Yuoth'] }, youngPeople, {
      employment: 'Employment',
      Yuoth: 'Youth',
    })
    expect(result).toEqual({ themes: ['Youth', 'Employment'], outside: [], undecided: [] })
  })

  it('drops a value left out, and treats a cell of only those as blank', () => {
    expect(
      grantThemes({ themes: ['Youth', 'Sport'] }, youngPeople, { Youth: 'Youth', Sport: null })
        .themes,
    ).toEqual(['Youth'])
    expect(grantThemes({ themes: ['Sport'] }, youngPeople, { Sport: null }).themes).toEqual(
      youngPeople,
    )
  })

  it('reports rather than drops a theme outside the programme, and a value with no decision', () => {
    const result = grantThemes({ themes: ['Rewilding', 'Other'] }, youngPeople, {
      Rewilding: 'Rewilding',
    })
    expect(result.outside).toEqual(['Rewilding'])
    expect(result.undecided).toEqual(['Other'])
  })

  it('gives a programme with no themes none', () => {
    expect(grantThemes({ themes: [] }, null, {}).themes).toEqual([])
  })
})
