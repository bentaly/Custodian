// ─── A budget workbook's rows → the lines of Settings → Annual budget ────────
//
// The pure half of "upload a budget" (Notion: "Finance balance screen: adding income
// streams", section 7, agreed 2026-09-30). The reader (`./workbook`) hands over raw
// cells; this turns them into lines the Annual budget form can hold, and says plainly
// what it could not place.
//
// ## What it deliberately does not do
//
// - **Save anything.** The result lands in the form as unsaved changes, so the usual
//   Save button, the `annual_budget_set` audit row, the unsaved-changes guard and
//   `saveAnnualBudget`'s own checks all apply. There is no server function of its own:
//   the save is the boundary, and it already re-validates every line.
// - **Guess with a model.** Classification is the Type column in the template, and a
//   programme is matched by name the way the onboarding import matches one (`match.ts`):
//   exact after normalisation applies silently, anything else is proposed and confirmed
//   once per distinct value. AI classification was proposed and left out (Ben,
//   2026-09-30): the template makes it unnecessary.
// - **Drop a row silently.** A row it cannot read is listed with the reason, and a row
//   whose type it cannot tell is offered for a decision.
//
// ## Monthly or annual?
//
// The likeliest misreading of somebody's budget is a figure that is per month where
// the column meant per year. The template's column says "Amount for the year", and the
// review screen states that assumption and lets it be flipped (`AmountBasis`), which
// applies to every cost and income line at once. Programme lines are always a year.

import { asDate, asNumber, asText } from '../dataImport/parse'
import { normalise, resolveColumn, type Candidate, type ValueResolution } from '../dataImport/match'
import { periodsIn, round2, type CostFrequency } from '../coreCosts'

/** What a row is, as the file says it. `null` when the Type cell is blank or unreadable. */
export type UploadType = 'programme' | 'cost' | 'income'

/** One data row as the reader found it, keyed by column. */
export type RawBudgetRow = {
  /** The sheet the row is on. Expenditure and Income both have a row 5. */
  sheet: string
  rowNumber: number
  cells: Partial<Record<BudgetColumnKey, unknown>>
}

export type BudgetColumnKey = 'line' | 'type' | 'amount' | 'frequency' | 'date' | 'fixed'

export type ParsedBudgetRow = {
  sheet: string
  rowNumber: number
  /** The Line cell: a programme's name, or the name of a cost or income line. */
  name: string
  /** NULL when the file does not say, or says something else. The review screen asks. */
  type: UploadType | null
  /** The Type cell as written, when it was not one of the three: shown beside the question. */
  typeWritten: string | null
  /** As written in the file, before `AmountBasis` is applied. Always > 0. */
  amount: number
  frequency: CostFrequency
  dueDate: string | null
  fixed: boolean
}

/** A row left out, or read with an assumption somebody should see. */
export type RowNote = {
  sheet: string
  rowNumber: number
  name: string | null
  message: string
  /** TRUE when the row is not in what goes into the form. */
  leftOut: boolean
}

/** A row's identity across sheets: what a decision about one row is keyed on. */
export function rowKey(r: { sheet: string; rowNumber: number }): string {
  return `${r.sheet}!${r.rowNumber}`
}

/** Where a row is, in words: "Income row 4". */
export function rowPlace(r: { sheet: string; rowNumber: number }): string {
  return `${r.sheet} row ${r.rowNumber}`
}

/** Whether the file's cost and income amounts are for the whole year or each payment. */
export type AmountBasis = 'year' | 'payment'

const TYPE_WORDS: Record<string, UploadType> = {
  programme: 'programme',
  programmes: 'programme',
  program: 'programme',
  grant: 'programme',
  grants: 'programme',
  'grant making': 'programme',
  cost: 'cost',
  costs: 'cost',
  'core cost': 'cost',
  'core costs': 'cost',
  expense: 'cost',
  expenses: 'cost',
  expenditure: 'cost',
  income: 'income',
  revenue: 'income',
}

const FREQUENCY_WORDS: Record<string, CostFrequency> = {
  monthly: 'monthly',
  month: 'monthly',
  'per month': 'monthly',
  'a month': 'monthly',
  quarterly: 'quarterly',
  quarter: 'quarterly',
  'per quarter': 'quarterly',
  'one off': 'one_off',
  oneoff: 'one_off',
  once: 'one_off',
  // Paid once a year is a one-off with a date: there is no "annual" placement.
  annual: 'one_off',
  annually: 'one_off',
  yearly: 'one_off',
}

const YES = new Set(['yes', 'y', 'fixed', 'true', '1'])

/** Parse every row. Pure; the matching against programmes is `resolveProgrammes`. */
export function parseBudgetRows(raw: RawBudgetRow[]): {
  rows: ParsedBudgetRow[]
  notes: RowNote[]
} {
  const rows: ParsedBudgetRow[] = []
  const notes: RowNote[] = []

  for (const r of raw) {
    const name = asText(r.cells.line)
    const typeText = asText(r.cells.type)
    const type = typeText ? (TYPE_WORDS[normalise(typeText)] ?? null) : null
    const amount = asNumber(r.cells.amount)

    if (amount === null || !(amount > 0)) {
      // A blank or zero amount is the file saying "nothing here", exactly as a blank
      // amount does on the form. Only an amount that is there and unreadable is news.
      const there = r.cells.amount != null && asText(r.cells.amount) !== null
      if (there && amount === null) {
        notes.push({
          sheet: r.sheet,
          rowNumber: r.rowNumber,
          name,
          message: `The amount "${asText(r.cells.amount)}" could not be read as a number.`,
          leftOut: true,
        })
      } else if (amount !== null && amount < 0) {
        notes.push({
          sheet: r.sheet,
          rowNumber: r.rowNumber,
          name,
          message: 'The amount is negative. Put income under the Income type instead.',
          leftOut: true,
        })
      }
      continue
    }

    if (type === 'programme' && !name) {
      notes.push({
        sheet: r.sheet,
        rowNumber: r.rowNumber,
        name: null,
        message: 'A programme row needs the programme’s name in the Line column.',
        leftOut: true,
      })
      continue
    }

    const frequencyText = asText(r.cells.frequency)
    let frequency: CostFrequency = 'monthly'
    if (frequencyText) {
      const read = FREQUENCY_WORDS[normalise(frequencyText)]
      if (read) frequency = read
      else if (type !== 'programme') {
        notes.push({
          sheet: r.sheet,
          rowNumber: r.rowNumber,
          name,
          message: `"${frequencyText}" is not Monthly, Quarterly or One-off, so it has been read as Monthly.`,
          leftOut: false,
        })
      }
    }

    const date = asDate(r.cells.date)
    if (frequency === 'one_off' && !date.iso && type !== 'programme') {
      notes.push({
        sheet: r.sheet,
        rowNumber: r.rowNumber,
        name,
        message: date.ambiguous
          ? 'The date could be read two ways (day/month or month/day). Pick it on the form before saving.'
          : 'A one-off needs a date. Pick it on the form before saving.',
        leftOut: false,
      })
    }

    rows.push({
      sheet: r.sheet,
      rowNumber: r.rowNumber,
      name: name ?? '',
      type,
      typeWritten: type ? null : typeText,
      amount,
      frequency,
      // A one-off's day, or the day a monthly or quarterly line starts (blank = the year's
      // start). Ignored on a programme line.
      dueDate: date.iso,
      fixed: YES.has(normalise(asText(r.cells.fixed) ?? '')),
    })
  }

  return { rows, notes }
}

/**
 * The distinct programme names in the file, resolved against the foundation's
 * programmes. `exact` needs nothing; the rest are the review screen's questions.
 */
export function resolveProgrammes(
  rows: ParsedBudgetRow[],
  programmes: Candidate[],
): ValueResolution[] {
  return resolveColumn(
    rows.filter((r) => r.type === 'programme').map((r) => r.name),
    programmes,
  )
}

/** What the review screen decided for everything the file left open. */
export type UploadDecisions = {
  /** Distinct programme name in the file → programme id, or `null` to leave those rows out. */
  programmes: Record<string, string | null>
  /** `rowKey` → the type chosen for a row whose file did not say, or `null` to leave it out. */
  types: Record<string, UploadType | null>
  basis: AmountBasis
}

/** A cost or income line ready for the form. `amount` is the YEAR's figure. */
export type TimedLine = {
  kind: 'cost' | 'income'
  label: string
  amount: number
  frequency: CostFrequency
  dueDate: string | null
  fixed: boolean
}

export type Translation = {
  /** Programme id → the year's figure. Two rows naming one programme are added together. */
  programmeAmounts: Map<string, number>
  lines: TimedLine[]
  /** Rows the decisions left out, and programmes named twice. */
  notes: RowNote[]
}

/**
 * Apply the review screen's decisions: every row becomes a programme amount, a cost
 * or income line, or a note saying why it did not.
 *
 * Kept separate from `parseBudgetRows` so flipping the basis or re-choosing a programme
 * re-runs this alone, against rows that were parsed once.
 */
export function translateBudget(
  rows: ParsedBudgetRow[],
  decisions: UploadDecisions,
  resolutions: ValueResolution[],
  fy: { start: string; end: string },
): Translation {
  const programmeAmounts = new Map<string, number>()
  const lines: TimedLine[] = []
  const notes: RowNote[] = []
  const exact = new Map(
    resolutions.flatMap((r) => (r.match.kind === 'exact' ? [[r.value, r.match.candidate.id]] : [])),
  )
  const seen = new Map<string, string>()

  for (const row of rows) {
    const type = row.type ?? decisions.types[rowKey(row)] ?? null
    if (type === null) {
      notes.push({
        sheet: row.sheet,
        rowNumber: row.rowNumber,
        name: row.name || null,
        message: 'Left out: no type chosen.',
        leftOut: true,
      })
      continue
    }

    if (type === 'programme') {
      const key = row.name.trim()
      const id = exact.get(key) ?? decisions.programmes[key] ?? null
      if (!id) {
        notes.push({
          sheet: row.sheet,
          rowNumber: row.rowNumber,
          name: row.name,
          message: 'Left out: not matched to one of your programmes.',
          leftOut: true,
        })
        continue
      }
      if (seen.has(id)) {
        notes.push({
          sheet: row.sheet,
          rowNumber: row.rowNumber,
          name: row.name,
          message: `The same programme as ${seen.get(id)}. The two amounts have been added together.`,
          leftOut: false,
        })
      } else {
        seen.set(id, rowPlace(row))
      }
      programmeAmounts.set(id, round2((programmeAmounts.get(id) ?? 0) + row.amount))
      continue
    }

    const perPayment = decisions.basis === 'payment' && row.frequency !== 'one_off'
    lines.push({
      kind: type,
      label: row.name,
      amount: perPayment
        ? round2(row.amount * periodsIn(row.frequency, fy, row.dueDate))
        : row.amount,
      frequency: row.frequency,
      dueDate: row.dueDate,
      fixed: type === 'income' && row.fixed,
    })
  }

  return { programmeAmounts, lines, notes }
}

/**
 * Settle the Type of a row the file left blank when its name IS one of the foundation's
 * programmes, exactly after normalisation: "Youth Futures" with no type is a programme
 * line, and asking would be a question for our benefit. Anything else stays open for
 * the review screen. Never guesses between Cost and Income.
 */
export function inferTypes(rows: ParsedBudgetRow[], programmes: Candidate[]): ParsedBudgetRow[] {
  const names = new Set(programmes.map((p) => normalise(p.name)))
  return rows.map((r) =>
    r.type === null && names.has(normalise(r.name)) ? { ...r, type: 'programme' } : r,
  )
}
