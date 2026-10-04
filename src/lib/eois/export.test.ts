import { describe, expect, it } from 'vitest'
import { toCsv } from '../spreadsheetExport'
import { eoiExportColumns, type EoiExportRow } from './export'

const base: EoiExportRow = {
  organisationName: 'Ladder Lane Youth Project',
  reference: 'demo-1',
  charityNumber: '1187305',
  companyNumber: null,
  contactEmail: 'priya@ladderlane.org.uk',
  amountIndicative: '35000',
  status: 'submitted',
  partnershipId: null,
  createdAt: '2026-10-04T20:00:00.000Z',
  responses: [
    { label: 'What would you like funding for?', value: 'An employability programme.' },
    { label: 'Charity number', value: '1187305' },
  ],
}

describe('exporting expressions of interest', () => {
  it('gives every question its own column, in the order first seen', () => {
    const second: EoiExportRow = {
      ...base,
      organisationName: 'Settlefield',
      responses: [{ label: 'Where would the work happen?', value: 'Leeds' }],
    }
    const headers = eoiExportColumns([base, second]).map((c) => c.header)
    expect(headers.slice(9)).toEqual([
      'What would you like funding for?',
      'Charity number (as answered)',
      'Where would the work happen?',
    ])
  })

  it('leaves a question an EOI was not asked empty', () => {
    const second: EoiExportRow = { ...base, organisationName: 'Settlefield', responses: [] }
    const csv = toCsv(eoiExportColumns([base, second]), [base, second]).split('\n')
    expect(csv[2]).toContain('"Settlefield"')
    expect(csv[2]!.endsWith('"",""')).toBe(true)
  })

  it('states the status and where it came from in words', () => {
    const csv = toCsv(eoiExportColumns([base]), [base])
    expect(csv).toContain('"To review"')
    expect(csv).toContain('"Open call"')
    expect(csv).toContain('"2026-10-04"')
  })
})
