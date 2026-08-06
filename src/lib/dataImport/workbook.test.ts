import { describe, expect, it } from 'vitest'
import { buildTemplate, readWorkbook } from './workbook'
import { LOOKUP_SHEET, SHEETS, TEMPLATE_VERSION } from './columns'
import { parseGrants } from './parse'

// The template generator and the reader are two halves of one contract, and the whole
// "no column mapping" design rests on it holding: we write headers, dropdowns and a
// fingerprint, and we must be able to read our own file back. These tests are the
// round trip, because a mismatch here fails at a client's desk rather than in CI.

const ctx = {
  clientId: '11111111-1111-1111-1111-111111111111',
  foundationName: 'Wharfedale Trust',
  lookups: {
    programmes: ['Community & Place', 'Environment & Nature'],
    rounds: ['Spring 2025', 'Autumn 2025'],
  },
}

async function templateAsFile(): Promise<File> {
  const blob = await buildTemplate(ctx)
  return new File([blob], 'template.xlsx', { type: blob.type })
}

describe('buildTemplate / readWorkbook round trip', () => {
  it('writes a workbook we can read back, with the fingerprint intact', async () => {
    const read = await readWorkbook(await templateAsFile())

    expect(read.fingerprint).toEqual({
      version: TEMPLATE_VERSION,
      clientId: ctx.clientId,
    })
  })

  it('recognises every column it wrote, with none left unmapped', async () => {
    const read = await readWorkbook(await templateAsFile())

    for (const key of ['grants', 'payments', 'reports'] as const) {
      expect(read.missingHeaders[key]).toEqual([])
      expect(read.unknownHeaders[key]).toEqual([])
    }
  })

  it('starts empty — a fresh template must not import phantom rows', async () => {
    const read = await readWorkbook(await templateAsFile())

    expect(read.sheets.grants).toEqual([])
    expect(read.sheets.payments).toEqual([])
    expect(read.sheets.reports).toEqual([])
  })

  // The dropdowns are the reason a filled-in template needs no column matching. If
  // ExcelJS ever stops writing them the file still opens, so nothing would fail —
  // the loss would be silent, which is exactly what this test is for.
  it('arms the Programme and Round columns with dropdowns from the client’s own lists', async () => {
    const ExcelJS = await import('exceljs')
    const wb = new ExcelJS.default.Workbook()
    await wb.xlsx.load(await (await buildTemplate(ctx)).arrayBuffer())

    const grants = wb.getWorksheet('Grants')!
    const programmeIndex = SHEETS.grants.columns.findIndex((c) => c.key === 'programme') + 1
    const cell = grants.getCell(2, programmeIndex)

    expect(cell.dataValidation?.type).toBe('list')
    expect(cell.dataValidation?.formulae?.[0]).toContain(LOOKUP_SHEET)
  })

  it('offers Status as a fixed list rather than free text', async () => {
    const ExcelJS = await import('exceljs')
    const wb = new ExcelJS.default.Workbook()
    await wb.xlsx.load(await (await buildTemplate(ctx)).arrayBuffer())

    const statusIndex = SHEETS.grants.columns.findIndex((c) => c.key === 'status') + 1
    const cell = wb.getWorksheet('Grants')!.getCell(2, statusIndex)

    expect(cell.dataValidation?.formulae?.[0]).toContain('Active')
  })

  it('hides the lookup sheet so nobody edits it by accident', async () => {
    const ExcelJS = await import('exceljs')
    const wb = new ExcelJS.default.Workbook()
    await wb.xlsx.load(await (await buildTemplate(ctx)).arrayBuffer())

    expect(wb.getWorksheet(LOOKUP_SHEET)?.state).toBe('veryHidden')
  })

  // A file generated for one foundation must be identifiable as theirs, so uploading
  // it into another tenant is refused rather than quietly importing their programmes.
  it('carries the client id, so another tenant’s file can be refused', async () => {
    const other = await readWorkbook(
      new File(
        [await buildTemplate({ ...ctx, clientId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' })],
        'x.xlsx',
      ),
    )
    expect(other.fingerprint?.clientId).not.toBe(ctx.clientId)
  })

  it('reads a filled-in row all the way through to a parsed grant', async () => {
    const ExcelJS = await import('exceljs')
    const wb = new ExcelJS.default.Workbook()
    await wb.xlsx.load(await (await buildTemplate(ctx)).arrayBuffer())

    const grants = wb.getWorksheet('Grants')!
    const values: Record<string, unknown> = {
      reference: 'GR-001',
      organisationName: 'Pennine Youth Alliance',
      programme: 'Community & Place',
      round: 'Spring 2025',
      awardDate: '2025-06-01',
      amountAwarded: 45000,
      status: 'Active',
      charityNumber: '1122334',
    }
    SHEETS.grants.columns.forEach((col, i) => {
      if (values[col.key] !== undefined) grants.getCell(2, i + 1).value = values[col.key] as never
    })

    const buffer = await wb.xlsx.writeBuffer()
    const read = await readWorkbook(new File([buffer], 'filled.xlsx'))

    expect(read.sheets.grants).toHaveLength(1)
    const parsed = parseGrants(read.sheets.grants)
    expect(parsed.issues).toEqual([])
    expect(parsed.rows[0]).toMatchObject({
      reference: 'GR-001',
      organisationName: 'Pennine Youth Alliance',
      amountAwarded: 45000,
      status: 'active',
      awardDate: '2025-06-01',
    })
  })

  it('rejects a file that is not a workbook at all, with a readable message', async () => {
    await expect(readWorkbook(new File(['not a spreadsheet'], 'notes.txt'))).rejects.toThrow(
      /could not be opened/i,
    )
  })
})
