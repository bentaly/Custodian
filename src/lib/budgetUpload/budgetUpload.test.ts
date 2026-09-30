import { describe, expect, it } from 'vitest'
import {
  inferTypes,
  parseBudgetRows,
  resolveProgrammes,
  rowKey,
  translateBudget,
  type RawBudgetRow,
  type UploadDecisions,
} from './translate'
import {
  buildBudgetTemplate,
  readBudgetWorkbook,
  EXPENDITURE_SHEET,
  INCOME_SHEET,
} from './workbook'
import { loadExcelJs } from '../spreadsheetExport'

// "Upload a budget" (Notion: "Finance balance screen: adding income streams", §7). The
// rules that matter are all in the translation: a figure is never guessed at, a row is
// never dropped without saying so, and the per-month misreading can be flipped.

const FY = { start: '2026-04-01', end: '2027-03-31' }

const PROGRAMMES = [
  { id: 'youth', name: 'Youth Futures' },
  { id: 'warm', name: 'Warm Homes' },
]

let n = 1
const row = (cells: RawBudgetRow['cells'], sheet = 'Expenditure'): RawBudgetRow => ({
  sheet,
  rowNumber: ++n,
  cells,
})

const decide = (over: Partial<UploadDecisions> = {}): UploadDecisions => ({
  programmes: {},
  types: {},
  basis: 'year',
  ...over,
})

function translate(raw: RawBudgetRow[], over: Partial<UploadDecisions> = {}) {
  const parsed = parseBudgetRows(raw)
  const rows = inferTypes(parsed.rows, PROGRAMMES)
  const resolutions = resolveProgrammes(rows, PROGRAMMES)
  return { parsed, rows, resolutions, ...translateBudget(rows, decide(over), resolutions, FY) }
}

describe('parseBudgetRows', () => {
  it('reads each kind of line, with the words people actually type', () => {
    const { parsed } = translate([
      row({ line: 'Youth Futures', type: 'Programme', amount: 120_000 }),
      row({ line: 'Rent', type: 'Core costs', amount: '£24,000', frequency: 'monthly' }),
      row({
        line: 'Dividends',
        type: 'income',
        amount: 16_000,
        frequency: 'Quarterly',
        fixed: 'Yes',
      }),
      row({ line: 'Audit', type: 'Cost', amount: 6_000, frequency: 'One-off', date: '2026-12-01' }),
    ])
    expect(parsed.notes).toEqual([])
    expect(
      parsed.rows.map((r) => [r.name, r.type, r.amount, r.frequency, r.dueDate, r.fixed]),
    ).toEqual([
      ['Youth Futures', 'programme', 120_000, 'monthly', null, false],
      ['Rent', 'cost', 24_000, 'monthly', null, false],
      ['Dividends', 'income', 16_000, 'quarterly', null, true],
      ['Audit', 'cost', 6_000, 'one_off', '2026-12-01', false],
    ])
  })

  it('skips blank amounts quietly, and names an unreadable or negative one', () => {
    const { parsed } = translate([
      row({ line: 'Warm Homes', type: 'Programme', amount: null }),
      row({ line: 'Travel', type: 'Cost', amount: 'about 2k' }),
      row({ line: 'Refund', type: 'Cost', amount: -500 }),
    ])
    expect(parsed.rows).toEqual([])
    expect(parsed.notes.map((x) => [x.name, x.leftOut])).toEqual([
      ['Travel', true],
      ['Refund', true],
    ])
  })

  it('keeps a one-off with no date, and says it needs one before saving', () => {
    const { parsed } = translate([
      row({ line: 'Legal', type: 'Cost', amount: 2_000, frequency: 'one-off' }),
    ])
    expect(parsed.rows[0]).toMatchObject({ frequency: 'one_off', dueDate: null })
    expect(parsed.notes[0]).toMatchObject({ leftOut: false })
    expect(parsed.notes[0]!.message).toMatch(/needs a date/)
  })
})

describe('translateBudget', () => {
  it('applies an exact programme name silently, and a blank Type on one', () => {
    const t = translate([
      row({ line: 'youth futures', type: 'Programme', amount: 100_000 }),
      row({ line: 'Warm Homes', amount: 50_000 }),
    ])
    expect(t.resolutions.every((r) => r.match.kind === 'exact')).toBe(true)
    expect([...t.programmeAmounts]).toEqual([
      ['youth', 100_000],
      ['warm', 50_000],
    ])
  })

  it('leaves an unmatched programme OUT until somebody picks one, and says so', () => {
    const raw = [row({ line: 'Youth Future', type: 'Programme', amount: 100_000 })]
    const open = translate(raw)
    expect(open.resolutions[0]!.match.kind).toBe('suggestion')
    expect(open.programmeAmounts.size).toBe(0)
    expect(open.notes[0]).toMatchObject({ leftOut: true })

    const picked = translate(raw, { programmes: { 'Youth Future': 'youth' } })
    expect([...picked.programmeAmounts]).toEqual([['youth', 100_000]])
  })

  it('adds two rows naming one programme together, and notes it', () => {
    const t = translate([
      row({ line: 'Youth Futures', type: 'Programme', amount: 60_000 }),
      row({ line: 'Youth Futures', type: 'Programme', amount: 40_000 }),
    ])
    expect(t.programmeAmounts.get('youth')).toBe(100_000)
    expect(t.notes[0]!.message).toMatch(/added together/)
  })

  it('never guesses between cost and income: an untyped line waits for a decision', () => {
    const raw = [row({ line: 'Gift Aid', amount: 3_000 })]
    const open = translate(raw)
    expect(open.rows[0]!.type).toBeNull()
    expect(open.lines).toEqual([])

    const chosen = translate(raw, { types: { [rowKey(open.rows[0]!)]: 'income' } })
    expect(chosen.lines).toMatchObject([{ kind: 'income', label: 'Gift Aid', amount: 3_000 }])
  })

  it('reads amounts as the year, and multiplies them when told they are per payment', () => {
    const raw = [
      row({ line: 'Rent', type: 'Cost', amount: 2_000, frequency: 'Monthly' }),
      row({ line: 'Dividends', type: 'Income', amount: 4_000, frequency: 'Quarterly' }),
      row({ line: 'Audit', type: 'Cost', amount: 6_000, frequency: 'One-off', date: '2026-12-01' }),
      row({ line: 'Youth Futures', type: 'Programme', amount: 100_000 }),
    ]
    expect(translate(raw).lines.map((l) => l.amount)).toEqual([2_000, 4_000, 6_000])
    const perPayment = translate(raw, { basis: 'payment' })
    // A one-off is one payment either way, and a programme line is always a year.
    expect(perPayment.lines.map((l) => l.amount)).toEqual([24_000, 16_000, 6_000])
    expect(perPayment.programmeAmounts.get('youth')).toBe(100_000)
  })

  it('only ever marks INCOME as fixed', () => {
    const t = translate([row({ line: 'Rent', type: 'Cost', amount: 2_000, fixed: 'Yes' })])
    expect(t.lines[0]!.fixed).toBe(false)
  })
})

describe('buildBudgetTemplate / readBudgetWorkbook round trip', () => {
  const ctx = {
    clientId: '11111111-1111-1111-1111-111111111111',
    foundationName: 'Wharfedale Trust',
    yearLabel: '2026/27',
    programmes: ['Youth Futures', 'Warm Homes'],
    lines: [
      {
        name: 'Youth Futures',
        type: 'programme' as const,
        amount: 100_000,
        frequency: null,
        dueDate: null,
        fixed: false,
      },
      {
        name: 'Audit',
        type: 'cost' as const,
        amount: 6_000,
        frequency: 'one_off' as const,
        dueDate: '2026-12-01',
        fixed: false,
      },
      {
        name: 'Dividends',
        type: 'income' as const,
        amount: 16_000,
        frequency: 'quarterly' as const,
        dueDate: null,
        fixed: true,
      },
    ],
  }
  const asFile = (blob: Blob) => new File([blob], 'budget.xlsx', { type: blob.type })

  it('reads its own template back into the same lines', async () => {
    const read = await readBudgetWorkbook(asFile(await buildBudgetTemplate(ctx)))
    expect(read.fingerprint).toEqual({ clientId: ctx.clientId, yearLabel: '2026/27' })

    const t = translate(read.rows)
    expect([...t.programmeAmounts]).toEqual([['youth', 100_000]])
    expect(t.lines).toEqual([
      {
        kind: 'cost',
        label: 'Audit',
        amount: 6_000,
        frequency: 'one_off',
        dueDate: '2026-12-01',
        fixed: false,
      },
      {
        kind: 'income',
        label: 'Dividends',
        amount: 16_000,
        frequency: 'quarterly',
        dueDate: null,
        fixed: true,
      },
    ])
  })

  it('puts the first line on row 2 of each sheet, not after the dropdown rows', async () => {
    // The dropdowns once went on first, and every prefilled line landed on row 301.
    const ExcelJS = await loadExcelJs()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await (await buildBudgetTemplate(ctx)).arrayBuffer())
    const expenditure = wb.getWorksheet(EXPENDITURE_SHEET)!
    const income = wb.getWorksheet(INCOME_SHEET)!
    expect(expenditure.getRow(2).getCell(1).value).toBe('Youth Futures')
    expect(expenditure.getRow(4).getCell(1).value).toBe('Audit')
    expect(income.getRow(2).getCell(1).value).toBe('Dividends')
  })

  it('splits income from expenditure, and reads every Income row as income', async () => {
    const read = await readBudgetWorkbook(asFile(await buildBudgetTemplate(ctx)))
    expect(read.rows.map((r) => [r.sheet, r.rowNumber, r.cells.line])).toEqual([
      ['Expenditure', 2, 'Youth Futures'],
      // Unbudgeted: in the file so it can be filled in, skipped on upload while blank.
      ['Expenditure', 3, 'Warm Homes'],
      ['Expenditure', 4, 'Audit'],
      ['Income', 2, 'Dividends'],
    ])
    // No Type column on Income: the sheet says it.
    expect(read.rows.at(-1)!.cells.type).toBe('Income')
  })

  it('reads a budget laid out by hand under near-enough headers', async () => {
    const ExcelJS = await loadExcelJs()
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Our budget')
    ws.addRow(['Budget line', 'Category', 'Annual budget'])
    ws.addRow(['Warm Homes', 'Grants', 80_000])
    ws.addRow(['Salaries', 'Expenditure', 90_000])
    const read = await readBudgetWorkbook(asFile(new Blob([await wb.xlsx.writeBuffer()])))
    expect(read.fingerprint).toBeNull()
    const t = translate(read.rows)
    expect([...t.programmeAmounts]).toEqual([['warm', 80_000]])
    expect(t.lines).toMatchObject([{ kind: 'cost', label: 'Salaries', amount: 90_000 }])
  })

  it('refuses a workbook with none of the columns, rather than guessing', async () => {
    const ExcelJS = await loadExcelJs()
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Sheet1').addRow(['Something', 'Else'])
    await expect(
      readBudgetWorkbook(asFile(new Blob([await wb.xlsx.writeBuffer()]))),
    ).rejects.toThrow(/Line, Type and Amount/)
  })
})
