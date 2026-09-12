// ─── The Themes column: matching it, and turning it into a grant's themes ────
//
// A grant's themes are a subset of its programme's (`applications.themes`), and the
// workbook states them as one semicolon-separated cell — Excel's dropdowns hold one
// value per cell, so there is no list validation to lean on. This is what catches
// mistakes instead, in the same two passes programme and round get:
//
//   1. every DISTINCT value is matched against the foundation's themes (`match.ts`) —
//      exact-after-normalisation applies silently, anything else is confirmed once on
//      the review screen and settles every row using it;
//   2. each grant's values are checked against its OWN programme's themes, because a
//      real theme that belongs to a different programme is still the wrong answer.
//
// A blank cell is not a gap: it means every theme the programme has. Themes are never
// created by an import — a programme's list is set on the programme.

import { resolveColumn, type Candidate, type ValueResolution } from './match'
import type { GrantRow } from './parse'
import type { ValidationIssue } from './validate'

export type ProgrammeWithThemes = { id: string; name: string; tags: string[] | null }

/** Every distinct theme across the foundation's programmes, as match candidates. */
export function themeCandidates(programmes: ProgrammeWithThemes[]): Candidate[] {
  const seen = new Map<string, string>()
  for (const p of programmes) {
    for (const t of p.tags ?? []) {
      const name = t.trim()
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((name) => ({ id: name, name }))
}

/** The Themes column resolved per distinct value, as programme and round are. */
export function resolveThemeValues(
  grants: Pick<GrantRow, 'themes'>[],
  programmes: ProgrammeWithThemes[],
): ValueResolution[] {
  return resolveColumn(
    grants.flatMap((g) => g.themes),
    themeCandidates(programmes),
  )
}

const sameTheme = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Grants naming a theme their programme does not have, found as early as it can be —
 * where both the programme and the theme matched exactly, so no human decision on the
 * review screen could change the answer. A blocker: the fix is to correct the file or
 * add the theme to the programme, neither of which the review screen can do.
 * Anything settled by a confirmation instead is re-checked at commit (`grantThemes`).
 */
export function themeMismatchIssues(
  grants: Pick<GrantRow, 'rowNumber' | 'programme' | 'themes'>[],
  programmes: ProgrammeWithThemes[],
  programmeResolutions: ValueResolution[],
  themeResolutions: ValueResolution[],
): ValidationIssue[] {
  const programmeById = new Map(programmes.map((p) => [p.id, p]))
  const exactProgramme = new Map<string, ProgrammeWithThemes>()
  for (const r of programmeResolutions) {
    const p = r.match.kind === 'exact' ? programmeById.get(r.match.candidate.id) : undefined
    if (p) exactProgramme.set(r.value, p)
  }
  const exactTheme = new Map<string, string>()
  for (const r of themeResolutions) {
    if (r.match.kind === 'exact') exactTheme.set(r.value, r.match.candidate.name)
  }

  const rows: number[] = []
  const examples = new Map<string, string>()
  for (const grant of grants) {
    const programme = exactProgramme.get(grant.programme.trim())
    if (!programme) continue
    for (const value of grant.themes) {
      const theme = exactTheme.get(value)
      if (!theme || (programme.tags ?? []).some((t) => sameTheme(t, theme))) continue
      if (!rows.includes(grant.rowNumber)) rows.push(grant.rowNumber)
      examples.set(
        `${theme}|${programme.name}`,
        `“${theme}” is not one of ${programme.name}’s themes`,
      )
    }
  }
  if (rows.length === 0) return []

  const listed = [...examples.values()]
  return [
    {
      kind: 'blocker',
      code: 'theme_not_in_programme',
      message: `${rows.length} ${rows.length === 1 ? 'grant names a theme' : 'grants name a theme'} its programme doesn’t have`,
      detail: `${listed.slice(0, 3).join('; ')}${listed.length > 3 ? `; and ${listed.length - 3} more` : ''}. Use the themes listed for that programme on the Start here sheet, or add the theme to the programme first.`,
      rows,
    },
  ]
}

/**
 * One grant's themes, once every distinct value has a decision.
 *
 * `mapping` is value → theme, or null for "leave it out". Returns the themes in the
 * programme's own order and spelling, plus any value that resolved to a theme OUTSIDE
 * this grant's programme — which the caller must refuse rather than drop, because a
 * silently lost theme is the failure this whole column exists to prevent.
 *
 * Blank → every theme the programme has. So is a cell whose every value was left out:
 * that cell said nothing usable, which is the same answer as a blank one.
 */
export function grantThemes(
  grant: Pick<GrantRow, 'themes'>,
  programmeThemes: string[] | null,
  mapping: Record<string, string | null>,
): { themes: string[]; outside: string[]; undecided: string[] } {
  const offered = (programmeThemes ?? []).map((t) => t.trim()).filter(Boolean)
  const outside: string[] = []
  const undecided: string[] = []
  const chosen: string[] = []

  for (const value of grant.themes) {
    if (!(value in mapping)) {
      undecided.push(value)
      continue
    }
    const theme = mapping[value]
    if (theme == null) continue
    const own = offered.find((o) => sameTheme(o, theme))
    if (own) chosen.push(own)
    else outside.push(value)
  }

  const themes = offered.filter((o) => chosen.includes(o))
  return { themes: themes.length > 0 ? themes : offered, outside, undecided }
}
