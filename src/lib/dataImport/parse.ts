// ─── Raw cells → typed rows ─────────────────────────────────────────────────
//
// Pure coercion, deliberately separate from the workbook reader so the awkward parts
// (dates that arrive as three different types, money typed as "£45,000") are testable
// without an .xlsx fixture. The reader hands over `Record<header, cell>` and this
// turns it into rows the validator and the commit path can reason about.

import { columnsFor, type ImportColumn, type SheetKey } from './columns'

export type RawRow = { rowNumber: number; cells: Record<string, unknown> }

export type CellIssue = {
  rowNumber: number
  column: string
  message: string
  /** Which sheet the row is on. Three sheets share column names ("Application
   *  reference", "Due date", "Amount"), so a message without this names no place a
   *  person can go and look, and two sheets' rows merge into one list. */
  sheet: SheetKey
  /** The reference on a GRANT row that was dropped for being unreadable. Its payments
   *  and reports then match no grant, and would otherwise be reported as orphans
   *  pointing at a reference which is in fact perfectly correct. */
  reference?: string
}

export type GrantRow = {
  rowNumber: number
  reference: string
  organisationName: string
  programme: string
  round: string
  awardDate: string
  amountAwarded: number
  /** The lump "paid to date" figure. Only used when the grant has no payment rows. */
  amountPaid: number | null
  status: 'active' | 'completed' | 'cancelled'
  charityNumber: string | null
  companyNumber: string | null
  contactEmail: string | null
  deliveryArea: string | null
  purpose: string | null
  /**
   * The Themes cell as the foundation typed it, one entry per semicolon-separated value.
   * Not yet matched to anything: that is per DISTINCT value on the review screen, like
   * programme and round. Empty means "every theme its programme has".
   */
  themes: string[]
  endDate: string | null
  /** Whole years the grant runs for, where the workbook says. */
  durationYears: number | null
  impactQuantity: number | null
  bankAccountName: string | null
  bankSortCode: string | null
  bankAccountNumber: string | null
}

export type PaymentRow = {
  rowNumber: number
  reference: string
  dueDate: string
  amount: number
  paid: boolean
  paidDate: string | null
}

export type ReportRow = {
  rowNumber: number
  reference: string
  label: string
  dueDate: string
  /**
   * Whether the report came in — the answer, not the date. A foundation that never
   * logged the arrival date of a report still knows it arrived, and before this
   * existed a blank date was the only signal, so every such milestone read as overdue.
   */
  received: boolean
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
/**
 * Is this a day that exists? A month-length check, leap years included.
 *
 * Day 1-31 was the whole test, so "2025-02-30" and "31/04/2025" came through as real
 * dates and went two different wrong ways afterwards: `new Date('2025-02-30T00:00:00Z')`
 * rolls silently to 2 March, which is what an award's decision date became, while a
 * column Postgres types as `date` refuses the same string outright and takes the whole
 * import down with it, naming no row. The function already refuses a date it cannot read
 * unambiguously; one that cannot exist belongs in the same place, as a cell issue beside
 * the row that carries it.
 */
function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= lengths[month - 1]!
}

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
    if (!isRealDate(Number(y), Number(m), Number(d))) return { iso: null, ambiguous: false }
    return {
      iso: `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`,
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
      if (!isRealDate(Number(y), second, first)) return { iso: null, ambiguous: false }
      return {
        iso: `${y}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`,
        ambiguous: false,
      }
    }
    return { iso: null, ambiguous: true }
  }

  return { iso: null, ambiguous: false }
}

/**
 * A sort code or account number: digits that are text, not a quantity.
 *
 * The template formats both columns as text so Excel leaves them alone, but that only
 * helps a file that was filled in from the template. A pasted column, or a cell someone
 * reformatted, arrives as a NUMBER, and by then 00123456 is already 123456 — the zeros
 * were eaten before we ever saw the file.
 *
 * So a numeric cell is zero-padded back to `width`. That is a guess, but a safe one:
 * the modulus check runs over the result and a wrong pad shows up in Finance as a
 * failed check, which is a flag next to a grant rather than a silent wrong answer.
 * Nothing in Custodian pays anybody, so the worst case is a human looking twice.
 *
 * A value already the right length, or one with dashes and spaces in it, is passed
 * through untouched; `digitsOnly` in the modulus checker normalises the rest.
 */
export function asCode(value: unknown, width: number): string | null {
  if (typeof value === 'number') {
    if (!isFinite(value) || value < 0 || !Number.isInteger(value)) return null
    return String(value).padStart(width, '0')
  }
  const text = asText(value)
  if (!text) return null
  // Only pad where the cell is bare digits. "40-47-84" is already unambiguous, and a
  // string someone typed with its zeros intact must not be padded twice.
  if (/^\d+$/.test(text) && text.length < width) return text.padStart(width, '0')
  return text
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

/** An issue as a parser builds it: the sheet is stamped on at the end, so no helper in
 *  this file has to carry the same constant through fifteen call sites. */
type RawIssue = Omit<CellIssue, 'sheet'>

/** Stamps the sheet onto a parser's issues on the way out. Kept here rather than
 *  threaded through `required` and `dateCell`, which would put the same constant in
 *  fifteen call sites. */
function onSheet(issues: RawIssue[], sheet: SheetKey): CellIssue[] {
  return issues.map((i) => ({ ...i, sheet }))
}

function required<T>(
  value: T | null,
  column: ImportColumn,
  rowNumber: number,
  issues: RawIssue[],
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
  issues: RawIssue[],
): string | null {
  const { iso, ambiguous } = asDate(raw)
  if (ambiguous) {
    issues.push({
      rowNumber,
      column: column.header,
      message: `${column.header} could be read as either day/month or month/day. Write it as YYYY-MM-DD`,
    })
    return null
  }
  if (iso == null && raw != null && raw !== '') {
    issues.push({
      rowNumber,
      column: column.header,
      message: `${column.header} is not a date we can read. Use YYYY-MM-DD`,
    })
  }
  return iso
}

/**
 * A multi-value cell → its values. Semicolons, not commas, are the separator — a theme
 * name can contain a comma ("Arts, culture and heritage") and cannot be told apart from
 * two themes if commas split. A line break inside the cell (Alt+Enter) also separates,
 * because that is the other way people put a list in one cell. Duplicates typed twice
 * collapse, case-insensitively.
 */
export function splitThemes(value: unknown): string[] {
  const text = asText(value)
  if (!text) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of text.split(/[;\n\r]+/)) {
    const t = part.trim()
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

const byKey = (sheet: SheetKey) =>
  Object.fromEntries(columnsFor(sheet).map((c) => [c.key, c])) as Record<string, ImportColumn>

export function parseGrants(rows: RawRow[]): { rows: GrantRow[]; issues: CellIssue[] } {
  const cols = byKey('grants')
  const issues: RawIssue[] = []
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

    const amountPaid = asNumber(cells.amountPaid)
    if (amountPaid != null && amountPaid < 0) {
      issues.push({
        rowNumber,
        column: cols.amountPaid!.header,
        message: 'Amount paid cannot be negative',
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
      // Tag this row's issues with the reference that is about to go missing, so the
      // orphan check downstream can say "belongs to a grant we could not read" instead
      // of blaming the payment rows that name it.
      if (reference) {
        for (const issue of issues) {
          if (issue.rowNumber === rowNumber) issue.reference = reference
        }
      }
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
      amountPaid,
      status,
      charityNumber: asText(cells.charityNumber),
      companyNumber: asText(cells.companyNumber),
      contactEmail: asText(cells.contactEmail),
      deliveryArea: asText(cells.deliveryArea),
      purpose: asText(cells.purpose),
      themes: splitThemes(cells.themes),
      endDate: dateCell(cells.endDate, cols.endDate!, rowNumber, issues),
      // Whole years only: "2.5 years" is not a thing a grant agreement says, and a
      // fraction here would print as "2.5 yrs" on the register.
      durationYears: (() => {
        const n = asNumber(cells.durationYears)
        return n != null && n > 0 ? Math.round(n) : null
      })(),
      impactQuantity: asNumber(cells.impactQuantity),
      bankAccountName: asText(cells.bankAccountName),
      bankSortCode: asCode(cells.bankSortCode, 6),
      bankAccountNumber: asCode(cells.bankAccountNumber, 8),
    })
  }

  return { rows: out, issues: onSheet(issues, 'grants') }
}

export function parsePayments(rows: RawRow[]): { rows: PaymentRow[]; issues: CellIssue[] } {
  const cols = byKey('payments')
  const issues: RawIssue[] = []
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
    // Both money columns on the Grants sheet refuse a negative figure and this one did
    // not, so a clawback or refund keyed the way a ledger keys one, "(5,000)", imported
    // as an instalment of minus five thousand pounds. Nothing else in Custodian can
    // produce that: every other writer goes through `buildSchedule`, whose split is
    // checked against the award. Once in, it quietly reduces both the paid and the
    // outstanding totals on Finance, and a foundation cannot see why.
    if (amount != null && amount < 0) {
      issues.push({
        rowNumber,
        column: cols.amount!.header,
        message: 'Amount cannot be negative',
      })
    }
    const paid = asBool(cells.paid)
    if (paid == null) {
      issues.push({ rowNumber, column: cols.paid!.header, message: 'Paid? must be Yes or No' })
    }

    // Required, not merely asked for: an undated instalment falls in no financial year,
    // so Balance & budget would leave it out of every figure.
    const dueDate = required(
      dateCell(cells.dueDate, cols.dueDate!, rowNumber, issues),
      cols.dueDate!,
      rowNumber,
      issues,
    )
    const paidDate = dateCell(cells.paidDate, cols.paidDate!, rowNumber, issues)

    if (reference == null || dueDate == null || amount == null || amount < 0 || paid == null)
      continue

    out.push({ rowNumber, reference, dueDate, amount, paid, paidDate })
  }

  return { rows: out, issues: onSheet(issues, 'payments') }
}

export function parseReports(rows: RawRow[]): { rows: ReportRow[]; issues: CellIssue[] } {
  const cols = byKey('reports')
  const issues: RawIssue[] = []
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

    // Blank means "not received" — which is also how a v1 workbook, written before the
    // column existed, reads: no flag anywhere, so a date is the only evidence. A date
    // present always wins over a "No", because a report cannot have arrived on a day
    // and also not have arrived.
    //
    // A non-empty answer we cannot read is a different thing from a blank one, and used
    // to fall into the same `?? false`. "Paid?" and "Received?" are the same kind of
    // cell, and the Payments sheet has always held the import until somebody says which
    // it is. Here a foundation that had written "Received" against every report they
    // held saw every one of them imported as outstanding, then overdue, with nothing on
    // any screen saying the column had been ignored.
    const answered = asText(cells.received) !== null || typeof cells.received === 'boolean'
    const flag = asBool(cells.received)
    if (answered && flag == null) {
      issues.push({
        rowNumber,
        column: cols.received!.header,
        message: 'Received? must be Yes or No',
      })
    }
    const received = receivedDate != null || (flag ?? false)

    if (reference == null || label == null || dueDate == null || (answered && flag == null))
      continue

    out.push({ rowNumber, reference, label, dueDate, received, receivedDate })
  }

  return { rows: out, issues: onSheet(issues, 'reports') }
}
