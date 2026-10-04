// ─── An EOI list as a spreadsheet ────────────────────────────────────────────
//
// One row per expression of interest, for one programme. The fixed columns are what
// Custodian read off each EOI; after them comes one column per QUESTION the foundation's
// form asked, in the order the questions were first seen, so the file reads like the
// form's own responses export. Different forms (or a form that changed) simply add
// columns, and an EOI that was not asked a question leaves that cell empty.
//
// Pure: the screen fetches the rows (`exportEois`) and builds the file in the browser,
// with the shared `toCsv` the other exports use.

import type { ExportColumn } from '../spreadsheetExport'
import { EOI_STATUS_META, type EoiStatus } from './status'

export type EoiExportRow = {
  organisationName: string
  reference: string | null
  charityNumber: string | null
  companyNumber: string | null
  contactEmail: string | null
  amountIndicative: string | null
  status: EoiStatus
  partnershipId: string | null
  createdAt: Date | string
  responses: Array<{ label: string; value: string }>
}

export function eoiExportColumns(rows: EoiExportRow[]): ExportColumn<EoiExportRow>[] {
  const fixed: ExportColumn<EoiExportRow>[] = [
    { header: 'Organisation', value: (r) => r.organisationName, width: 32 },
    // ISO, so a spreadsheet sorts it as a date.
    {
      header: 'Received',
      kind: 'date',
      value: (r) => new Date(r.createdAt).toISOString().slice(0, 10),
    },
    { header: 'Status', value: (r) => EOI_STATUS_META[r.status].label },
    { header: 'Came from', value: (r) => (r.partnershipId ? 'Partnership' : 'Open call') },
    { header: 'Indicative amount', kind: 'money', value: (r) => r.amountIndicative },
    { header: 'Contact email', value: (r) => r.contactEmail },
    { header: 'Charity number', value: (r) => r.charityNumber },
    { header: 'Company number', value: (r) => r.companyNumber },
    { header: 'Reference', value: (r) => r.reference },
  ]

  // Every question, once, in first-seen order. A question whose wording matches a fixed
  // header is still its own column: it is what they WROTE, the fixed one what we read.
  const questions: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const answer of row.responses) {
      if (seen.has(answer.label)) continue
      seen.add(answer.label)
      questions.push(answer.label)
    }
  }
  const asked = questions.map(
    (label): ExportColumn<EoiExportRow> => ({
      header: fixed.some((c) => c.header === label) ? `${label} (as answered)` : label,
      width: 40,
      value: (r) => r.responses.find((a) => a.label === label)?.value,
    }),
  )
  return [...fixed, ...asked]
}
