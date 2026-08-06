// ─── Raw cells → typed rows ─────────────────────────────────────────────────
//
// Pure coercion, deliberately separate from the workbook reader so the awkward parts
// (dates that arrive as three different types, money typed as "£45,000") are testable
// without an .xlsx fixture. The reader hands over `Record<header, cell>` and this
// turns it into rows the validator and the commit path can reason about.

import { columnsFor, type ImportColumn, type SheetKey } from './columns'

export type RawRow = { rowNumber: number; cells: Record<string, unknown> }

export type CellIssue = { rowNumber: number; column: string; message: string }

export type GrantRow = {
  rowNumber: number
  reference: string
  organisationName: string
  programme: string
  round: string
  awardDate: string
  amountAwarded: number
  status: 'active' | 'completed' | 'cancelled'
  charityNumber: string | null
  companyNumber: string | null
  contactEmail: string | null
  deliveryArea: string | null
  purpose: string | null
  endDate: string | null
  impactQuantity: number | null
}

export type PaymentRow = {
  rowNumber: number
  reference: string
  dueDate: string | null
  amount: number
  paid: boolean
  paidDate: string | null
}

export type ReportRow = {
  rowNumber: number
  reference: string
  label: string
  dueDate: string
  receivedDate: string | null
}

// ─── Cell coercion ──────────────────────────────────────────────────────────

function asText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const t = value.trim()
    return t === '' ? null : t
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // ExcelJS hands back rich text and formula results as objects.
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    if (typeof o.text === 'string') return o.text.trim() || null
    if (typeof o.result === 'string') return o.result.trim() || null
    if (typeof o.result === 'number') return String(o.result)
    if (Array.isArray(o.richText)) {
      return (
        o.richText
          .map((r) => (typeof r === 'object' && r && 'text' in r ? String(r.text) : ''))
          .join('')
          .trim() || null
      )
    }
  }
  return null
}

/**
 * Money and counts. Tolerates what people actually type: `£45,000`, `45 000`,
 * `(1,200)` for a negative. Returns null rather than NaN so the caller decides
 * whether an unreadable cell is fatal.
 */
export function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return isFinite(value) ? value : null
  const text = asText(value)
  if (!text) return null
  const negative = /^\(.*\)$/.test(text)
  const cleaned = text.replace(/[()£$€,\s]/g, '')
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null
  const n = parseFloat(cleaned)
  if (!isFinite(n)) return null
  return negative ? -n : n
}

/**
 * Dates as ISO `yyyy-mm-dd`, which is what every date column in the schema stores.
 * Excel gives us a real Date for a date-formatted cell and a string for a text one,
 * so both are handled. Ambiguous numeric formats are rejected rather than guessed:
 * `03/04/2025` is April in Britain and March in America, and quietly picking one
 * would misdate a payment by a month with nothing on screen to show for it.
 */
export function asDate(value: unknown): { iso: string | null; ambiguous: boolean } {
  if (value == null || value === '') return { iso: null, ambiguous: false }

  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { iso: null, ambiguous: false }
    // Excel dates arrive as UTC midnight; reading UTC parts avoids a timezone
    // shift dragging the date back a day west of Greenwich.
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return { iso: `${y}-${m}-${d}`, ambiguous: false }
  }

  const text = asText(value)
  if (!text) return { iso: null, ambiguous: false }

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) {
    const [, y, m, d] = iso
    const month = Number(m)
    const day = Number(d)
    if (month < 1 || month > 12 || day < 1 || day > 31) return { iso: null, ambiguous: false }
    return {
      iso: `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      ambiguous: false,
    }
  }

  const slashed = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (slashed) {
    const [, a, b, y] = slashed
    const first = Number(a)
    const second = Number(b)
    // Only unambiguous when one part cannot be a month.
    if (first > 12 && second <= 12) {
      return {
        iso: `${y}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`,
        ambiguous: false,
      }
    }
    return { iso: null, ambiguous: true }
  }

  return { iso: null, ambiguous: false }
}

function asBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  const text = asText(value)
  if (!text) return null
  const t = text.toLowerCase()
  if (['yes', 'y', 'true', 'paid', '1'].includes(t)) return true
  if (['no', 'n', 'false', 'unpaid', '0'].includes(t)) return false
  return null
}

// ─── Row builders ───────────────────────────────────────────────────────────

function required<T>(
  value: T | null,
  column: ImportColumn,
  rowNumber: number,
  issues: CellIssue[],
  message = 'is required',
): T | null {
  if (value == null) {
    issues.push({ rowNumber, column: column.header, message: `${column.header} ${message}` })
    return null
  }
  return value
}

function dateCell(
  raw: unknown,
  column: ImportColumn,
  rowNumber: number,
  issues: CellIssue[],
): string | null {
  const { iso, ambiguous } = asDate(raw)
  if (ambiguous) {
    issues.push({
      rowNumber,
      column: column.header,
      message: `${column.header} could be read as either day/month or month/day — write it as YYYY-MM-DD`,
    })
    return null
  }
  if (iso == null && raw != null && raw !== '') {
    issues.push({
      rowNumber,
      column: column.header,
      message: `${column.header} is not a date we can read — use YYYY-MM-DD`,
    })
  }
  return iso
}

const byKey = (sheet: SheetKey) =>
  Object.fromEntries(columnsFor(sheet).map((c) => [c.key, c])) as Record<string, ImportColumn>

export function parseGrants(rows: RawRow[]): { rows: GrantRow[]; issues: CellIssue[] } {
  const cols = byKey('grants')
  const issues: CellIssue[] = []
  const out: GrantRow[] = []

  for (const { rowNumber, cells } of rows) {
    const reference = asText(cells.reference)
    const organisationName = required(
      asText(cells.organisationName),
      cols.organisationName!,
      rowNumber,
      issues,
    )
    const programme = required(asText(cells.programme), cols.programme!, rowNumber, issues)
    const round = required(asText(cells.round), cols.round!, rowNumber, issues)
    const awardDate = required(
      dateCell(cells.awardDate, cols.awardDate!, rowNumber, issues),
      cols.awardDate!,
      rowNumber,
      issues,
    )
    const amountAwarded = required(
      asNumber(cells.amountAwarded),
      cols.amountAwarded!,
      rowNumber,
      issues,
      'is required and must be a number',
    )

    const statusText = asText(cells.status)?.toLowerCase() ?? null
    let status: GrantRow['status'] | null = null
    if (statusText === 'active') status = 'active'
    else if (statusText === 'completed' || statusText === 'complete') status = 'completed'
    else if (statusText === 'cancelled' || statusText === 'canceled') status = 'cancelled'
    else {
      issues.push({
        rowNumber,
        column: cols.status!.header,
        message: 'Status must be Active, Completed or Cancelled',
      })
    }

    if (amountAwarded != null && amountAwarded < 0) {
      issues.push({
        rowNumber,
        column: cols.amountAwarded!.header,
        message: 'Amount awarded cannot be negative',
      })
    }

    if (
      organisationName == null ||
      programme == null ||
      round == null ||
      awardDate == null ||
      amountAwarded == null ||
      status == null
    ) {
      continue
    }

    out.push({
      rowNumber,
      // A blank reference is legitimate — we mint one at commit for foundations that
      // have never used references. It is filled in here so downstream joins have a
      // key, and handed back in the summary so they know what we assigned.
      reference: reference ?? '',
      organisationName,
      programme,
      round,
      awardDate,
      amountAwarded,
      status,
      charityNumber: asText(cells.charityNumber),
      companyNumber: asText(cells.companyNumber),
      contactEmail: asText(cells.contactEmail),
      deliveryArea: asText(cells.deliveryArea),
      purpose: asText(cells.purpose),
      endDate: dateCell(cells.endDate, cols.endDate!, rowNumber, issues),
      impactQuantity: asNumber(cells.impactQuantity),
    })
  }

  return { rows: out, issues }
}

export function parsePayments(rows: RawRow[]): { rows: PaymentRow[]; issues: CellIssue[] } {
  const cols = byKey('payments')
  const issues: CellIssue[] = []
  const out: PaymentRow[] = []

  for (const { rowNumber, cells } of rows) {
    const reference = required(asText(cells.reference), cols.reference!, rowNumber, issues)
    const amount = required(
      asNumber(cells.amount),
      cols.amount!,
      rowNumber,
      issues,
      'is required and must be a number',
    )
    const paid = asBool(cells.paid)
    if (paid == null) {
      issues.push({ rowNumber, column: cols.paid!.header, message: 'Paid? must be Yes or No' })
    }

    const dueDate = dateCell(cells.dueDate, cols.dueDate!, rowNumber, issues)
    const paidDate = dateCell(cells.paidDate, cols.paidDate!, rowNumber, issues)

    if (reference == null || amount == null || paid == null) continue

    out.push({ rowNumber, reference, dueDate, amount, paid, paidDate })
  }

  return { rows: out, issues }
}

export function parseReports(rows: RawRow[]): { rows: ReportRow[]; issues: CellIssue[] } {
  const cols = byKey('reports')
  const issues: CellIssue[] = []
  const out: ReportRow[] = []

  for (const { rowNumber, cells } of rows) {
    const reference = required(asText(cells.reference), cols.reference!, rowNumber, issues)
    const label = required(asText(cells.label), cols.label!, rowNumber, issues)
    const dueDate = required(
      dateCell(cells.dueDate, cols.dueDate!, rowNumber, issues),
      cols.dueDate!,
      rowNumber,
      issues,
    )
    const receivedDate = dateCell(cells.receivedDate, cols.receivedDate!, rowNumber, issues)

    if (reference == null || label == null || dueDate == null) continue

    out.push({ rowNumber, reference, label, dueDate, receivedDate })
  }

  return { rows: out, issues }
}
