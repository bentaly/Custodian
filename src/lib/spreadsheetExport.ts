// A table export in either of the two formats a screen offers: CSV, or an Excel workbook.
//
// Both are built from ONE column list, so the two files cannot drift apart. What the
// workbook adds is types, and they are the reason it exists: a CSV cell has none, so a
// spreadsheet guesses, and it guesses an account number beginning with a zero is a number
// and drops the zero. In the workbook a `text` cell is stored as a string and Excel leaves
// it alone; `money` is a real number (it sums), and `date` is a real date (it sorts).
//
// Browser-side only, like the data-import template: ExcelJS is loaded on demand so a
// screen that never exports never downloads it.

export type ExportFormat = 'csv' | 'xlsx'

export type ExportColumn<Row> = {
  header: string
  /** `text` is written as a string whatever it looks like. Default `text`. */
  kind?: 'text' | 'money' | 'date'
  /** Characters, as Excel measures a column. */
  width?: number
  value: (row: Row) => string | number | null | undefined
}

type ExcelJsModule = typeof import('exceljs')

export async function loadExcelJs(): Promise<ExcelJsModule> {
  // The ESM build; `default` interop differs between bundler and runtime.
  const mod = (await import('exceljs')) as unknown as { default?: ExcelJsModule } & ExcelJsModule
  return mod.default ?? mod
}

export function toCsv<Row>(columns: ExportColumn<Row>[], rows: Row[]): string {
  const lines = [
    columns.map((c) => c.header),
    ...rows.map((r) => columns.map((c) => c.value(r) ?? '')),
  ]
  return lines
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

/** `yyyy-mm-dd` as a date at midnight UTC, which is what Excel shows as that day. */
function isoDay(value: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null
}

export async function toXlsx<Row>(
  columns: ExportColumn<Row>[],
  rows: Row[],
  sheetName: string,
): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Custodian'
  wb.created = new Date()

  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns.map((c) => ({
    header: c.header,
    width: c.width ?? Math.max(12, c.header.length + 2),
  }))
  ws.getRow(1).font = { bold: true }

  for (const row of rows) {
    const cells = columns.map((c) => {
      const v = c.value(row)
      if (v === null || v === undefined || v === '') return null
      if (c.kind === 'money') {
        const n = typeof v === 'number' ? v : Number(v)
        return Number.isFinite(n) ? n : String(v)
      }
      if (c.kind === 'date') return isoDay(String(v)) ?? String(v)
      return String(v)
    })
    ws.addRow(cells)
  }

  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    if (c.kind === 'money') col.numFmt = '£#,##0.00'
    if (c.kind === 'date') col.numFmt = 'dd/mm/yyyy'
  })
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** Builds the file in the chosen format and hands it to the browser as a download. */
export async function downloadTable<Row>({
  format,
  columns,
  rows,
  filename,
  sheetName,
}: {
  format: ExportFormat
  columns: ExportColumn<Row>[]
  rows: Row[]
  /** Without an extension; the format supplies it. */
  filename: string
  sheetName: string
}) {
  const blob =
    format === 'xlsx'
      ? await toXlsx(columns, rows, sheetName)
      : new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.${format}`
  a.click()
  URL.revokeObjectURL(url)
}
