// ─── The annual budget template: writing it, and reading it back ─────────────
//
// The budget's twin of `src/lib/dataImport/workbook.ts`, and built the same way for the
// same reasons: browser-side (ExcelJS is dynamically imported, so only somebody who
// uploads a budget pays for it), both directions in one file so the headers written are
// the headers read, and a hidden `_Custodian` sheet that fingerprints the file so one
// generated for another foundation is refused rather than read.
//
// TWO data sheets, the way a budget is laid out on paper: **Expenditure** (programmes and
// costs, with a Type column to tell them apart) and **Income** (every row is income, so
// no Type column, and the only sheet with the Fixed column). Both are prefilled with the
// year's current budget and Expenditure with a row for every programme, so "download,
// change a few figures, upload" is the common path and the programme names are already
// spelled the way Custodian spells them.
//
// ## Data first, dropdowns after
//
// The dropdowns are applied to a fixed run of rows, and ExcelJS counts a row carrying
// only a validation as a row in use. Applied first, they pushed every prefilled line to
// row 301 under three hundred blank ones (found 2026-09-30). The rows are written first
// and the round trip test pins that the first line is on row 2.
//
// A file without the fingerprint (somebody's own budget, laid out to the same headers)
// is still read: one sheet with a Type column will do. The template improves results but
// is not required. What cannot be read is a workbook with none of these headers, and
// that is said plainly.

import { loadExcelJs } from '../spreadsheetExport'
import { CUSTODIAN_MARK_PNG_BASE64 } from '../dataImport/logo'
import { normalise } from '../dataImport/match'
import type { CostFrequency } from '../coreCosts'
import type { BudgetColumnKey, RawBudgetRow, UploadType } from './translate'

export const BUDGET_TEMPLATE_VERSION = '2'
const LOOKUP_SHEET = '_Custodian'
const MARK = 'custodian-budget'
export const EXPENDITURE_SHEET = 'Expenditure'
export const INCOME_SHEET = 'Income'

type Column = {
  key: BudgetColumnKey
  header: string
  help: string
  width: number
  required?: boolean
  options?: string[]
  format?: string
  /** Other headers read as this column, for a budget laid out by hand. */
  aliases?: string[]
}

export const TYPE_LABEL: Record<UploadType, string> = {
  programme: 'Programme',
  cost: 'Cost',
  income: 'Income',
}

const FREQUENCY_LABEL: Record<CostFrequency, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_off: 'One-off',
}

const COLUMN: Record<BudgetColumnKey, Column> = {
  line: {
    key: 'line',
    header: 'Line',
    required: true,
    width: 34,
    help: 'For a programme, its name exactly as in Custodian (pick from the list). For anything else, any name: Rent, Staff, Investment income.',
    aliases: ['name', 'item', 'budget line', 'description'],
  },
  type: {
    key: 'type',
    header: 'Type',
    required: true,
    width: 16,
    options: [TYPE_LABEL.programme, TYPE_LABEL.cost],
    help: 'Programme (money for grants) or Cost (anything else going out).',
    aliases: ['kind', 'category'],
  },
  amount: {
    key: 'amount',
    header: 'Amount for the year',
    required: true,
    width: 22,
    format: '£#,##0.00',
    help: 'The whole year’s figure, even for a monthly or quarterly line. If your figures are per month, say so when you upload and Custodian will multiply them.',
    aliases: ['amount', 'annual amount', 'budget', 'total', 'annual budget'],
  },
  frequency: {
    key: 'frequency',
    header: 'How often',
    width: 16,
    options: Object.values(FREQUENCY_LABEL),
    help: 'Monthly, Quarterly or One-off. Blank is Monthly. Not needed on a programme row.',
    aliases: ['frequency', 'paid', 'how often paid'],
  },
  date: {
    key: 'date',
    header: 'Date',
    width: 16,
    format: 'dd/mm/yyyy',
    help: 'For a one-off, the day it is paid or arrives. For a monthly or quarterly line, the day it starts, if part-way through the year (blank = from the start of the year). Inside the financial year either way.',
    aliases: ['due date', 'date paid', 'payment date', 'start date', 'from', 'starts'],
  },
  fixed: {
    key: 'fixed',
    header: 'Fixed income',
    width: 16,
    options: ['Yes', 'No'],
    help: 'Yes for a signed pledge or a set dividend: it counts towards your available balance on Finance. No (or blank) for income you expect but cannot rely on.',
    aliases: ['fixed', 'fixed?', 'confirmed'],
  },
}

/** Each sheet's columns, in order. The Income sheet needs no Type: all of it is income. */
export const SHEET_COLUMNS: Record<'expenditure' | 'income', Column[]> = {
  expenditure: [COLUMN.line, COLUMN.type, COLUMN.amount, COLUMN.frequency, COLUMN.date],
  income: [COLUMN.line, COLUMN.amount, COLUMN.frequency, COLUMN.date, COLUMN.fixed],
}

export type TemplateLine = {
  name: string
  type: UploadType
  /** The year's figure. */
  amount: number
  frequency: CostFrequency | null
  dueDate: string | null
  fixed: boolean
}

export type BudgetTemplateContext = {
  clientId: string
  foundationName: string
  yearLabel: string
  /** Every active programme: a dropdown for the Line column, and a prefilled row each. */
  programmes: string[]
  /** The year's lines as they stand, prefilled so a small change is a small edit. */
  lines: TemplateLine[]
}

/** Rows given dropdowns below the last prefilled line, for new lines to be typed into. */
const SPARE_ROWS = 200
const INK = 'FF141C24'
const MUTED = 'FF637083'
const HEADER_FILL = 'FFF3F6F4'

function letter(index: number): string {
  return String.fromCharCode(64 + index)
}

export async function buildBudgetTemplate(ctx: BudgetTemplateContext): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Custodian'
  wb.title = `Custodian budget: ${ctx.foundationName} ${ctx.yearLabel}`
  wb.created = new Date()

  // ── Start here ──
  const intro = wb.addWorksheet('Start here')
  intro.getColumn(1).width = 26
  intro.getColumn(2).width = 96
  try {
    const logoId = wb.addImage({
      base64: `data:image/png;base64,${CUSTODIAN_MARK_PNG_BASE64}`,
      extension: 'png',
    })
    intro.addImage(logoId, { tl: { col: 0.25, row: 0.2 }, ext: { width: 34, height: 34 } })
  } catch {
    // Branding is not worth failing a download over.
  }
  intro.getRow(1).height = 34
  intro.addRow([])
  intro.addRow([`Annual budget ${ctx.yearLabel}: ${ctx.foundationName}`]).font = {
    size: 15,
    bold: true,
  }
  intro.addRow([])
  const paragraph = (text: string, height = 32) => {
    const row = intro.addRow(['', text])
    row.height = height
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
  }
  paragraph(
    'Fill in the Expenditure and Income sheets, one row per line, then upload the file in Settings → Annual budget. Nothing is saved on upload: the lines appear on the budget form for you to check, and you save them there.',
  )
  paragraph(
    'Both sheets already hold this year’s budget as it stands, and Expenditure has a row for each of your programmes. Uploading replaces the year’s lines with what is in the file, so leave in anything you want to keep.',
  )
  for (const [title, columns] of [
    [EXPENDITURE_SHEET, SHEET_COLUMNS.expenditure],
    [INCOME_SHEET, SHEET_COLUMNS.income],
  ] as const) {
    intro.addRow([])
    intro.addRow([title]).font = { size: 12, bold: true }
    for (const col of columns) {
      const row = intro.addRow([`    ${col.header}${col.required ? ' (required)' : ''}`, col.help])
      row.getCell(1).font = { size: 10 }
      row.getCell(2).font = { size: 10, color: { argb: MUTED } }
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    }
  }

  // ── Lookups + fingerprint ──
  const lookup = wb.addWorksheet(LOOKUP_SHEET)
  lookup.state = 'veryHidden'
  lookup.getCell('A1').value = MARK
  lookup.getCell('A2').value = BUDGET_TEMPLATE_VERSION
  lookup.getCell('A3').value = ctx.clientId
  lookup.getCell('A4').value = ctx.yearLabel
  ctx.programmes.forEach((p, i) => {
    lookup.getCell(`C${i + 2}`).value = p
  })

  /**
   * One data sheet: headers, then the prefilled rows from row 2, then the dropdowns over
   * the rows in use plus `SPARE_ROWS` more. In that order, or the rows land after the
   * dropdowns (see the module header).
   */
  const dataSheet = (title: string, columns: Column[], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(title)
    ws.columns = columns.map((c) => ({
      header: c.header + (c.required ? ' (required)' : ''),
      key: c.key,
      width: c.width,
    }))
    const head = ws.getRow(1)
    head.font = { bold: true, color: { argb: INK } }
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    head.height = 22
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    for (const r of rows) ws.addRow(r)

    const lastRow = rows.length + 1 + SPARE_ROWS
    columns.forEach((c, i) => {
      if (c.format) ws.getColumn(i + 1).numFmt = c.format
      const formula =
        c.options !== undefined
          ? `"${c.options.join(',')}"`
          : c.key === 'line' && title === EXPENDITURE_SHEET && ctx.programmes.length > 0
            ? `=${LOOKUP_SHEET}!$C$2:$C$${ctx.programmes.length + 1}`
            : null
      if (!formula) return
      for (let r = 2; r <= lastRow; r++) {
        ws.getCell(`${letter(i + 1)}${r}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: true,
          // A warning, never a stop: the Line column holds free names for costs, so the
          // programme list is a suggestion there, not a rule.
          errorStyle: 'warning',
          errorTitle: c.key === 'line' ? 'Not one of your programmes' : 'Not one of the options',
          error:
            c.key === 'line'
              ? 'Fine for a cost: choose Yes to keep it. For a programme, pick its name from the list.'
              : `Pick one of: ${c.options!.join(', ')}.`,
        }
      }
    })
  }

  const byProgramme = new Map(
    ctx.lines.filter((l) => l.type === 'programme').map((l) => [l.name, l.amount]),
  )
  const timed = (l: TemplateLine) => ({
    line: l.name,
    amount: l.amount,
    frequency: FREQUENCY_LABEL[l.frequency ?? 'monthly'],
    // A real Date, so Excel shows it in the column's format rather than as text.
    date: l.dueDate ? new Date(`${l.dueDate}T00:00:00Z`) : null,
  })

  dataSheet(EXPENDITURE_SHEET, SHEET_COLUMNS.expenditure, [
    ...ctx.programmes.map((p) => ({
      line: p,
      type: TYPE_LABEL.programme,
      amount: byProgramme.get(p) ?? null,
    })),
    ...ctx.lines
      .filter((l) => l.type === 'cost')
      .map((l) => ({ ...timed(l), type: TYPE_LABEL.cost })),
  ])
  dataSheet(
    INCOME_SHEET,
    SHEET_COLUMNS.income,
    ctx.lines
      .filter((l) => l.type === 'income')
      .map((l) => ({ ...timed(l), fixed: l.fixed ? 'Yes' : 'No' })),
  )

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export class BudgetWorkbookError extends Error {}

export type BudgetRead = {
  /** NULL for a workbook Custodian did not generate. */
  fingerprint: { clientId: string; yearLabel: string } | null
  rows: RawBudgetRow[]
}

/** A header reduced to what identifies it: the "(required)" suffix and case dropped. */
function baseHeader(text: string): string {
  return normalise(text.replace(/\((?:required|optional)\)\s*$/i, ''))
}

const HEADER_TO_KEY = new Map<string, BudgetColumnKey>(
  Object.values(COLUMN).flatMap((c) =>
    [c.header, ...(c.aliases ?? [])].map((h) => [baseHeader(h), c.key] as const),
  ),
)

/**
 * Read the budget rows out of a workbook.
 *
 * The template's Expenditure and Income sheets when either is there, every row on Income
 * being income whatever else it says. Otherwise the first sheet whose first row carries
 * the Line, Type and Amount headers, so a budget laid out by hand on one sheet can be read
 * too. Every row carries its sheet's name, since two sheets both have a row 5.
 */
export async function readBudgetWorkbook(file: File): Promise<BudgetRead> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(await file.arrayBuffer())
  } catch {
    throw new BudgetWorkbookError(
      'That file could not be opened as an Excel workbook. Save it as .xlsx and try again.',
    )
  }

  const lookup = wb.getWorksheet(LOOKUP_SHEET)
  const fingerprint =
    lookup && lookup.getCell('A1').value === MARK
      ? {
          clientId: String(lookup.getCell('A3').value ?? ''),
          yearLabel: String(lookup.getCell('A4').value ?? ''),
        }
      : null

  type Sheet = NonNullable<ReturnType<typeof wb.getWorksheet>>
  const headersOf = (ws: Sheet) => {
    const map = new Map<number, BudgetColumnKey>()
    ws.getRow(1).eachCell({ includeEmpty: false }, (cell, col) => {
      const key = HEADER_TO_KEY.get(baseHeader(String(cell.value ?? '')))
      if (key && ![...map.values()].includes(key)) map.set(col, key)
    })
    return map
  }
  const has = (m: Map<number, BudgetColumnKey>, keys: BudgetColumnKey[]) =>
    keys.every((k) => [...m.values()].includes(k))

  const rowsOf = (ws: Sheet, forceIncome: boolean): RawBudgetRow[] => {
    const columns = headersOf(ws)
    const out: RawBudgetRow[] = []
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const cells: RawBudgetRow['cells'] = {}
      let any = false
      columns.forEach((key, col) => {
        const value = row.getCell(col).value
        cells[key] = value
        if (value != null && value !== '') any = true
      })
      // Excel leaves formatted-but-empty rows behind constantly.
      if (!any) return
      if (forceIncome) cells.type = TYPE_LABEL.income
      out.push({ sheet: ws.name, rowNumber, cells })
    })
    return out
  }

  const expenditure = wb.getWorksheet(EXPENDITURE_SHEET)
  const income = wb.getWorksheet(INCOME_SHEET)
  if (expenditure || income) {
    const rows: RawBudgetRow[] = []
    for (const [ws, forceIncome, needs] of [
      [expenditure, false, ['line', 'type', 'amount']],
      [income, true, ['line', 'amount']],
    ] as const) {
      if (!ws) continue
      if (!has(headersOf(ws), [...needs])) {
        throw new BudgetWorkbookError(
          `The ${ws.name} sheet is missing its ${needs.length === 3 ? 'Line, Type or Amount for the year' : 'Line or Amount for the year'} column. Download a fresh template and copy your figures into it.`,
        )
      }
      rows.push(...rowsOf(ws, forceIncome))
    }
    return { fingerprint, rows }
  }

  const sheet = wb.worksheets.find(
    (w) => w.name !== LOOKUP_SHEET && has(headersOf(w), ['line', 'type', 'amount']),
  )
  if (!sheet) {
    throw new BudgetWorkbookError(
      'No sheet in that workbook has the Line, Type and Amount for the year columns. Download the template from this screen and fill that in instead.',
    )
  }
  return { fingerprint, rows: rowsOf(sheet, false) }
}
