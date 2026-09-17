import { describe, expect, it } from 'vitest'
import { loadExcelJs, toCsv, toXlsx, type ExportColumn } from './spreadsheetExport'

type Row = { name: string; account: string; amount: number; due: string | null }

const columns: ExportColumn<Row>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Account number', value: (r) => r.account },
  { header: 'Amount', kind: 'money', value: (r) => r.amount },
  { header: 'Due date', kind: 'date', value: (r) => r.due },
]

const rows: Row[] = [
  { name: 'Say "hello" Trust', account: '01234567', amount: 1250.5, due: '2026-10-01' },
  { name: 'No date', account: '00000001', amount: 10, due: null },
]

describe('toCsv', () => {
  it('quotes every cell, escapes quotes, and writes blanks for nulls', () => {
    expect(toCsv(columns, rows)).toBe(
      [
        '"Name","Account number","Amount","Due date"',
        '"Say ""hello"" Trust","01234567","1250.5","2026-10-01"',
        '"No date","00000001","10",""',
      ].join('\n'),
    )
  })
})

describe('toXlsx', () => {
  it('keeps a leading zero as text, writes money as a number and dates as dates', async () => {
    const blob = await toXlsx(columns, rows, 'Payments')
    const ExcelJS = await loadExcelJs()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await blob.arrayBuffer())
    const ws = wb.getWorksheet('Payments')!

    expect(ws.getRow(1).values).toEqual([undefined, 'Name', 'Account number', 'Amount', 'Due date'])
    // The whole reason for the format: this is the cell a CSV loses the zero from.
    expect(ws.getCell('B2').value).toBe('01234567')
    expect(ws.getCell('C2').value).toBe(1250.5)
    expect(ws.getCell('D2').value).toEqual(new Date('2026-10-01T00:00:00Z'))
    expect(ws.getCell('D3').value).toBeNull()
  })
})
