// ─── The .xlsx template: writing it, and reading it back ────────────────────
//
// Both directions live here because they are two halves of one contract — the headers
// we write are the headers we match on read, and the fingerprint we stamp is the one
// we check. Splitting them across files is how they drift.
//
// This module is BROWSER-SIDE on purpose. Parsing a workbook on the Worker would mean
// pushing a multi-megabyte binary through a request body and spending Worker CPU on
// it; doing it in the page is instant, gives the wizard immediate feedback, and sends
// the server tidy JSON instead. The server still re-validates everything it is sent —
// the browser is a convenience, never the authority.
//
// ExcelJS is imported dynamically so it lands in a route chunk rather than the main
// bundle. Nobody who isn't onboarding should pay for it.
//
// Deliberately NOT using sheet protection. It sounds appealing ("lock the headers")
// but Excel's protection also blocks inserting rows and pasting ranges unless every
// permission is enumerated exactly right, and getting that subtly wrong breaks the
// file for the one client who most needs it to work. Identification is handled by the
// fingerprint below instead, which is strictly more reliable and cannot lock anyone out.

import {
  columnAsk,
  headerLabel,
  LOOKUP_SHEET,
  SHEETS,
  TEMPLATE_VERSION,
  type ImportColumn,
  type SheetKey,
} from './columns'
import { CUSTODIAN_MARK_PNG_BASE64 } from './logo'
import type { RawRow } from './parse'

export type LookupLists = {
  programmes: string[]
  rounds: string[]
}

export type TemplateContext = {
  clientId: string
  foundationName: string
  lookups: LookupLists
}

/** How many rows of dropdowns to pre-arm. Beyond this the column is still valid. */
const VALIDATED_ROWS = 800

/** Every data column the same width: the headers now carry a "(required)" suffix, and
 * sizing each one to its own text left a ragged sheet where the widest column was the
 * least important. */
const DATA_COLUMN_WIDTH = 25

const INK = 'FF141C24'
const BODY = 'FF344054'
const MUTED = 'FF637083'
const HEADER_FILL = 'FFF3F6F4'
const TABLE_FILL = 'FFEFF2F6'

type ExcelJsModule = typeof import('exceljs')

async function loadExcelJs(): Promise<ExcelJsModule> {
  // The ESM build; `default` interop differs between bundler and runtime.
  const mod = (await import('exceljs')) as unknown as { default?: ExcelJsModule } & ExcelJsModule
  return mod.default ?? mod
}

// ─── Writing ────────────────────────────────────────────────────────────────

function columnLetter(index: number): string {
  let n = index
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export async function buildTemplate(ctx: TemplateContext): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Custodian'
  wb.company = 'Custodian'
  wb.title = `Custodian import — ${ctx.foundationName}`
  wb.created = new Date()

  // ── Instructions ──
  //
  // The sheet does one job before it lists any columns: say that active and completed
  // grants are filled in differently. Before that was stated, foundations either
  // itemised a decade of paid instalments they no longer needed, or gave up.
  const intro = wb.addWorksheet('Start here')
  intro.getColumn(1).width = 34
  intro.getColumn(2).width = 96

  /** A paragraph in the right-hand column, wrapped. Blank left cell by design. */
  const paragraph = (text: string, height = 46) => {
    const row = intro.addRow(['', text])
    row.height = height
    row.getCell(2).font = { size: 11 }
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    return row
  }
  const spacer = () => intro.addRow([])

  // The mark sits above the title rather than beside it: an image anchored into a cell
  // that also holds text covers the text at some zoom levels and no other.
  try {
    const logoId = wb.addImage({
      base64: `data:image/png;base64,${CUSTODIAN_MARK_PNG_BASE64}`,
      extension: 'png',
    })
    intro.addImage(logoId, {
      tl: { col: 0.25, row: 0.2 },
      ext: { width: 34, height: 34 },
      editAs: 'oneCell',
    })
  } catch {
    // Branding is not worth failing a download over.
  }
  intro.getRow(1).height = 34
  intro.addRow([])

  const title = intro.addRow([`Custodian import — ${ctx.foundationName}`])
  title.font = { size: 15, bold: true }
  spacer()
  paragraph('Fill in this workbook, then upload it in Settings → Data import.', 16)
  spacer()
  paragraph(
    'Custodian treats two kinds of grant differently. Active grants are still in progress — the award is ongoing, with outcomes still being delivered and reported — so they use all three sheets. Completed grants are historical — the grant has finished and its reporting is done — so they need only a single row on the Grants sheet. Set each grant’s Status accordingly, and follow the table below.',
  )
  spacer()

  // The active/completed table.
  const tableHead = intro.addRow(['Grant status', 'What to fill in'])
  tableHead.height = 22
  for (const c of [1, 2]) {
    tableHead.getCell(c).font = { size: 10, bold: true, color: { argb: BODY } }
    tableHead.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TABLE_FILL } }
    tableHead.getCell(c).alignment = { wrapText: true, vertical: 'middle' }
  }
  const tableRow = (label: string, text: string, height: number) => {
    const row = intro.addRow([label, text])
    row.height = height
    row.getCell(1).font = { size: 10, bold: true, color: { argb: BODY } }
    row.getCell(2).font = { size: 10, color: { argb: BODY } }
    for (const c of [1, 2]) row.getCell(c).alignment = { wrapText: true, vertical: 'top' }
  }
  tableRow(
    'Active grants',
    'Fill in all three sheets — Grants, Payments and Reports. “Active” means the award is still in progress, with outcomes being delivered and reported.',
    46,
  )
  tableRow(
    'Completed grants',
    'Fill in the Grants sheet only. Put the total paid in ‘Amount paid’ and the final impact in ‘Impact figure so far’, then leave the Payments and Reports sheets blank.',
    60,
  )
  spacer()

  paragraph(
    'You can upload again later to add more — re-uploading a grant updates it rather than duplicating it.',
  )
  spacer()
  paragraph(
    'This template is built with your own account data. The Programme and Round columns already list your foundation’s programmes and rounds, so you pick from a dropdown instead of typing, and everything connects to the right place in Custodian when you upload.',
  )
  paragraph(
    'If the round you need isn’t listed, just type the round name you’d like and we’ll create it in your Custodian account during the import. Programmes must already exist in Custodian, so please pick one from the dropdown.',
  )
  spacer()

  for (const key of ['grants', 'payments', 'reports'] as SheetKey[]) {
    const sheet = SHEETS[key]

    // Which grants this sheet is even for. Stated per sheet, because someone reading
    // the Payments block has usually scrolled past the table above it.
    const note = intro.addRow(['', sheet.note])
    note.getCell(2).font = { size: 10, bold: true, color: { argb: BODY } }
    note.getCell(2).alignment = { wrapText: true, vertical: 'top' }

    const header = intro.addRow([sheet.title, sheet.blurb])
    header.getCell(1).font = { size: 12, bold: true }
    header.getCell(2).font = { size: 10, color: { argb: MUTED } }
    header.getCell(2).alignment = { wrapText: true, vertical: 'top' }

    for (const col of sheet.columns) {
      const row = intro.addRow([`    ${headerLabel(col)}`, col.help])
      row.getCell(1).font = { size: 10 }
      row.getCell(2).font = { size: 10, color: { argb: MUTED } }
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    }
    spacer()
  }

  // ── Lookups + fingerprint ──
  //
  // The fingerprint is what lets us delete column-mapping entirely: on upload we
  // either recognise the file as ours and read it, or say so plainly rather than
  // guessing at someone else's spreadsheet.
  const lookup = wb.addWorksheet(LOOKUP_SHEET)
  lookup.state = 'veryHidden'
  lookup.getCell('A1').value = 'custodian-import'
  lookup.getCell('A2').value = TEMPLATE_VERSION
  lookup.getCell('A3').value = ctx.clientId
  lookup.getCell('A4').value = new Date().toISOString()

  const listRanges = new Map<string, string>()
  const writeList = (column: string, values: string[]) => {
    values.forEach((v, i) => {
      lookup.getCell(`${column}${i + 2}`).value = v
    })
    if (values.length > 0) {
      listRanges.set(column, `${LOOKUP_SHEET}!$${column}$2:$${column}$${values.length + 1}`)
    }
  }
  lookup.getCell('C1').value = 'Programmes'
  writeList('C', ctx.lookups.programmes)
  lookup.getCell('D1').value = 'Rounds'
  writeList('D', ctx.lookups.rounds)

  const listFor = (col: ImportColumn): string | null => {
    if (col.type === 'enum' && col.options) return `"${col.options.join(',')}"`
    if (col.lookup === 'programme') return listRanges.get('C') ? `=${listRanges.get('C')}` : null
    if (col.lookup === 'round') return listRanges.get('D') ? `=${listRanges.get('D')}` : null
    // The reference dropdown on Payments/Reports points at the Grants sheet's own
    // reference column, so a child row can only name a grant that is actually in the
    // file. This is the join key — an orphan here is a blocker at validation.
    if (col.lookup === 'reference') return `=Grants!$A$2:$A$${VALIDATED_ROWS}`
    return null
  }

  // ── Data sheets ──
  for (const key of ['grants', 'payments', 'reports'] as SheetKey[]) {
    const sheet = SHEETS[key]
    const ws = wb.addWorksheet(sheet.title)

    ws.columns = sheet.columns.map((col) => ({
      header: headerLabel(col),
      key: col.key,
      width: DATA_COLUMN_WIDTH,
    }))

    const headerRow = ws.getRow(1)
    headerRow.font = { bold: true, color: { argb: INK } }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    headerRow.alignment = { vertical: 'middle' }
    headerRow.height = 22
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    sheet.columns.forEach((col, i) => {
      const letter = columnLetter(i + 1)

      // Number and date formats, so a client typing 45000 sees £45,000 and a date
      // column cannot quietly become a string.
      if (col.type === 'money') ws.getColumn(i + 1).numFmt = '£#,##0'
      if (col.type === 'number') ws.getColumn(i + 1).numFmt = '#,##0'
      if (col.type === 'date') ws.getColumn(i + 1).numFmt = 'yyyy-mm-dd'

      const formula = listFor(col)
      if (!formula) return

      for (let r = 2; r <= VALIDATED_ROWS; r++) {
        ws.getCell(`${letter}${r}`).dataValidation = {
          type: 'list',
          allowBlank: columnAsk(col) !== 'required',
          formulae: [formula],
          showErrorMessage: true,
          errorStyle: 'warning',
          errorTitle: 'Not one of your options',
          error: `Pick a value from the list. If you pasted this in, check it matches — we will offer you the closest match when you upload.`,
        }
      }
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

// ─── Reading ────────────────────────────────────────────────────────────────

export type WorkbookFingerprint = { version: string; clientId: string } | null

export type ReadResult = {
  fingerprint: WorkbookFingerprint
  sheets: Record<SheetKey, RawRow[]>
  /** Headers we found but don't recognise — surfaced so a renamed column isn't silent. */
  unknownHeaders: Record<SheetKey, string[]>
  /** Required headers that are missing entirely. */
  missingHeaders: Record<SheetKey, string[]>
}

export class WorkbookError extends Error {}

/**
 * A header reduced to what identifies the column: lower-cased, trimmed, with the
 * "(required)" / "(optional)" suffix removed.
 *
 * The suffix is guidance for whoever fills the file in, not part of the column's
 * identity, so it is stripped rather than matched on — as are a stray trailing space
 * and a change of case. An unrecognised header is dropped, and a dropped column is
 * indistinguishable from one the foundation left blank.
 */
function baseHeader(text: string): string {
  return text
    .replace(/\((?:required|optional)\)\s*$/i, '')
    .toLowerCase()
    .trim()
}

export async function readWorkbook(file: File): Promise<ReadResult> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()

  try {
    await wb.xlsx.load(await file.arrayBuffer())
  } catch {
    throw new WorkbookError(
      'That file could not be opened as an Excel workbook. If you exported it from another system, save it as .xlsx and try again.',
    )
  }

  const lookup = wb.getWorksheet(LOOKUP_SHEET)
  let fingerprint: WorkbookFingerprint = null
  if (lookup && lookup.getCell('A1').value === 'custodian-import') {
    fingerprint = {
      version: String(lookup.getCell('A2').value ?? ''),
      clientId: String(lookup.getCell('A3').value ?? ''),
    }
  }

  const sheets = {} as Record<SheetKey, RawRow[]>
  const unknownHeaders = {} as Record<SheetKey, string[]>
  const missingHeaders = {} as Record<SheetKey, string[]>

  for (const key of ['grants', 'payments', 'reports'] as SheetKey[]) {
    const spec = SHEETS[key]
    const ws = wb.getWorksheet(spec.title)
    sheets[key] = []
    unknownHeaders[key] = []
    missingHeaders[key] = []

    if (!ws) {
      // A missing optional sheet is fine — plenty of foundations import grants with
      // no reporting schedule. A missing Grants sheet is not, and the validator says so.
      if (key === 'grants') {
        missingHeaders[key] = spec.columns.filter((c) => c.tier === 'required').map((c) => c.header)
      }
      continue
    }

    // Header row → column key, matched on the normalised header (see `baseHeader`).
    const headerRow = ws.getRow(1)
    const byHeader = new Map<string, string>()
    for (const col of spec.columns) {
      byHeader.set(baseHeader(col.header), col.key)
    }

    const indexToKey = new Map<number, string>()
    const foundKeys = new Set<string>()
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = baseHeader(String(cell.value ?? ''))
      if (!text) return
      const mapped = byHeader.get(text)
      if (mapped) {
        indexToKey.set(colNumber, mapped)
        foundKeys.add(mapped)
      } else {
        unknownHeaders[key].push(String(cell.value))
      }
    })

    missingHeaders[key] = spec.columns
      .filter((c) => c.tier === 'required' && !foundKeys.has(c.key))
      .map((c) => c.header)

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const cells: Record<string, unknown> = {}
      let hasValue = false
      indexToKey.forEach((columnKey, colNumber) => {
        const value = row.getCell(colNumber).value
        cells[columnKey] = value
        if (value != null && value !== '') hasValue = true
      })
      // Excel leaves formatted-but-empty rows behind constantly; importing them as
      // blank grants would produce dozens of phantom validation errors.
      if (hasValue) sheets[key].push({ rowNumber, cells })
    })
  }

  return { fingerprint, sheets, unknownHeaders, missingHeaders }
}
