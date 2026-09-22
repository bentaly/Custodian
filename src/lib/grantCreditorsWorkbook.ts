import type { CreditorLine, CreditorsReport } from './grantCreditors'
import { loadExcelJs } from './spreadsheetExport'
import { fmtDate } from './format'

/**
 * The grant creditors report as the Excel file a finance officer sends their accountant.
 *
 * Not `downloadTable`: that writes a bare table, and this file has to stand on its own in
 * an auditor's inbox. So it says what it is and as at when above the table, carries a
 * TOTALS row (as SUM formulas, so a line the accountant deletes or corrects moves the
 * total with it), and states its basis underneath. Browser-side like every export.
 */

type Col = {
  header: string
  width: number
  money?: boolean
  date?: boolean
  value: (l: CreditorLine) => string | number | null
}

export function creditorColumns(report: CreditorsReport): Col[] {
  const cols: Col[] = [
    { header: 'Grantee', width: 36, value: (l) => l.organisationName },
    { header: 'Grant reference', width: 18, value: (l) => l.reference },
    { header: 'Programme', width: 22, value: (l) => l.programmeName },
    { header: 'Round', width: 22, value: (l) => l.roundName },
    { header: 'Awarded on', width: 13, date: true, value: (l) => l.decisionDate },
    { header: 'Total awarded', width: 15, money: true, value: (l) => l.amountAwarded },
    { header: 'Paid by year end', width: 17, money: true, value: (l) => l.paidByYearEnd },
    {
      header: 'Unpaid, due within one year',
      width: 18,
      money: true,
      value: (l) => l.dueWithinOneYear,
    },
    {
      header: 'Unpaid, due after more than one year',
      width: 20,
      money: true,
      value: (l) => l.dueAfterOneYear,
    },
  ]
  // Only when there is something in it: a column of zeros on every file would ask the
  // accountant a question that, for most foundations, never arises.
  if (report.totals.noDueDate > 0) {
    cols.push({
      header: 'Unpaid, no due date set',
      width: 17,
      money: true,
      value: (l) => l.noDueDate,
    })
  }
  cols.push({ header: 'Total unpaid', width: 15, money: true, value: (l) => l.totalUnpaid })
  return cols
}

function columnLetter(n: number): string {
  let s = ''
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26))
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

export async function grantCreditorsWorkbook(
  report: CreditorsReport,
  foundationName: string | null,
): Promise<Blob> {
  const ExcelJS = await loadExcelJs()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Custodian'
  wb.created = new Date()

  const cols = creditorColumns(report)
  const HEADER_ROW = 4
  const ws = wb.addWorksheet('Grant creditors', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW }],
  })
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width
  })

  const title = ws.getCell('A1')
  title.value = `${foundationName ? `${foundationName}: g` : 'G'}rant creditors at ${fmtDate(report.yearEnd)}`
  title.font = { bold: true, size: 14 }
  ws.getCell('A2').value =
    `Grants committed on or before ${fmtDate(report.yearEnd)} and not paid by that date. ` +
    `"Within one year" means due on or before ${fmtDate(report.oneYearOn)}.`

  const header = ws.getRow(HEADER_ROW)
  header.values = cols.map((c) => c.header)
  header.font = { bold: true }
  header.alignment = { wrapText: true, vertical: 'top' }

  for (const line of report.lines) {
    ws.addRow(
      cols.map((c) => {
        const v = c.value(line)
        if (v === null || v === '') return null
        if (c.date) return new Date(`${v}T00:00:00Z`)
        return v
      }),
    )
  }

  const first = HEADER_ROW + 1
  const last = HEADER_ROW + report.lines.length
  const totals = ws.addRow(
    cols.map((c, i) => {
      if (i === 0)
        return `Total (${report.totals.count} grant${report.totals.count === 1 ? '' : 's'})`
      if (!c.money) return null
      const letter = columnLetter(i + 1)
      const result =
        report.lines.reduce((acc, l) => acc + Math.round(Number(c.value(l)) * 100), 0) / 100
      return report.lines.length
        ? { formula: `SUM(${letter}${first}:${letter}${last})`, result }
        : 0
    }),
  )
  totals.font = { bold: true }
  totals.eachCell((cell) => {
    cell.border = { top: { style: 'thin' } }
  })

  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    if (c.money) col.numFmt = '£#,##0.00'
    if (c.date) col.numFmt = 'dd/mm/yyyy'
  })

  const notes = [
    'Basis',
    'Taken from the payment schedules recorded in Custodian. If a payment date there is out of date, this report will be too.',
    'A payment made after the year end is shown as unpaid, because it was unpaid on that date.',
    'Payments due before the year end and still unpaid on it are included in "due within one year".',
    'Cancelled grants are excluded: nothing is left to pay on them.',
    ...(report.totals.noDueDate > 0
      ? [
          '"No due date set" is money owed on a grant with no date for it yet: an instalment marked "date to be confirmed", or part of the award no instalment covers.',
        ]
      : []),
  ]
  ws.addRow([])
  notes.forEach((text, i) => {
    const row = ws.addRow([text])
    if (i === 0) row.font = { bold: true }
  })

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
