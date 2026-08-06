// ─── Validation and reconciliation ──────────────────────────────────────────
//
// Everything wrong with an uploaded workbook, sorted into two kinds:
//
//   blocker      — the import cannot proceed. A missing required cell, a duplicate
//                  reference, a payment pointing at a grant that isn't in the file.
//   degradation  — the import proceeds, but something in the app will be thinner for
//                  it, and we say exactly what. These must NEVER block: a foundation
//                  that never recorded delivery areas should still be able to onboard,
//                  and holding their whole portfolio hostage over it would be
//                  disproportionate.
//
// The degradation wording is the same wording shown later on the grant itself, so the
// warning a client accepted and the gap they see afterwards always agree.

import { columnLabel, GRANT_COLUMNS, ONE_OF_GROUPS, PAYMENT_COLUMNS } from './columns'
import type { CellIssue, GrantRow, PaymentRow, ReportRow } from './parse'

export type IssueKind = 'blocker' | 'degradation'

export type ValidationIssue = {
  kind: IssueKind
  code: string
  /** One line, already counted — e.g. "42 grants have no location". */
  message: string
  /** What it costs, or what to do about it. */
  detail: string
  /** Spreadsheet row numbers, so the user can find them. Capped in the UI. */
  rows: number[]
}

export type Reconciliation = {
  grants: number
  activeGrants: number
  completedGrants: number
  payments: number
  reportMilestones: number
  totalCommitted: number
  totalPaid: number
  totalOutstanding: number
  reportsOutstanding: number
}

export type ValidationResult = {
  issues: ValidationIssue[]
  reconciliation: Reconciliation
  /** True when nothing blocks; the Reconcile step is only reachable when this is true. */
  canCommit: boolean
}

export type ExistingReference = { reference: string; importedByBatch: boolean }

const grantCol = (key: string) => GRANT_COLUMNS.find((c) => c.key === key)!
const paymentCol = (key: string) => PAYMENT_COLUMNS.find((c) => c.key === key)!

function plural(n: number, singular: string, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

export function validateImport(input: {
  grants: GrantRow[]
  payments: PaymentRow[]
  reports: ReportRow[]
  cellIssues: CellIssue[]
  /** References already in Custodian, so a re-upload updates and a clash is caught. */
  existingReferences?: ExistingReference[]
}): ValidationResult {
  const { grants, payments, reports, cellIssues } = input
  const existing = input.existingReferences ?? []
  const issues: ValidationIssue[] = []

  // ── Blockers ──

  if (grants.length === 0) {
    issues.push({
      kind: 'blocker',
      code: 'no_grants',
      message: 'The Grants sheet is empty',
      detail:
        'Every payment and report row hangs off a grant, so there is nothing to import without at least one.',
      rows: [],
    })
  }

  // Cell-level problems, grouped by column so 40 bad dates are one line, not forty.
  const byMessage = new Map<string, number[]>()
  for (const issue of cellIssues) {
    const list = byMessage.get(issue.message) ?? []
    list.push(issue.rowNumber)
    byMessage.set(issue.message, list)
  }
  for (const [message, rows] of byMessage) {
    issues.push({
      kind: 'blocker',
      code: 'cell',
      message: rows.length === 1 ? message : `${message} (${rows.length} rows)`,
      detail: 'Fix these in the review step below, or correct them in the workbook and re-upload.',
      rows,
    })
  }

  // Duplicate references inside the file. Left alone these would silently merge two
  // different grants into one, or fail the unique constraint at commit.
  const seen = new Map<string, number[]>()
  for (const g of grants) {
    if (!g.reference) continue
    const rows = seen.get(g.reference) ?? []
    rows.push(g.rowNumber)
    seen.set(g.reference, rows)
  }
  const duplicates = [...seen.entries()].filter(([, rows]) => rows.length > 1)
  if (duplicates.length > 0) {
    issues.push({
      kind: 'blocker',
      code: 'duplicate_reference',
      message: `${plural(duplicates.length, 'reference')} appears more than once`,
      detail: `Each grant needs its own reference: ${duplicates
        .slice(0, 5)
        .map(([ref]) => `“${ref}”`)
        .join(
          ', ',
        )}${duplicates.length > 5 ? '…' : ''}. Payments and reports join to grants by this value, so a repeat makes them ambiguous.`,
      rows: duplicates.flatMap(([, rows]) => rows),
    })
  }

  // A reference already used by a grant that did NOT come from an import is a real
  // clash — that grant was created in Custodian and the import would overwrite work.
  // A reference from a previous import batch is fine: that is the re-upload path.
  const clashing = new Set(
    existing.filter((e) => !e.importedByBatch).map((e) => e.reference.toLowerCase()),
  )
  const clashes = grants.filter((g) => g.reference && clashing.has(g.reference.toLowerCase()))
  if (clashes.length > 0) {
    issues.push({
      kind: 'blocker',
      code: 'reference_in_use',
      message: `${plural(clashes.length, 'reference')} already belongs to a grant created in Custodian`,
      detail:
        'These were not imported, so overwriting them would discard work done in the app. Change the reference in the workbook, or remove those rows.',
      rows: clashes.map((g) => g.rowNumber),
    })
  }

  // Payments and reports pointing at a grant that isn't in the file.
  const references = new Set(grants.map((g) => g.reference).filter(Boolean))
  const orphanPayments = payments.filter((p) => !references.has(p.reference))
  if (orphanPayments.length > 0) {
    issues.push({
      kind: 'blocker',
      code: 'orphan_payments',
      message: `${plural(orphanPayments.length, 'payment')} refers to a grant that is not on the Grants sheet`,
      detail: `Unmatched references: ${[...new Set(orphanPayments.map((p) => p.reference))]
        .slice(0, 5)
        .map((r) => `“${r}”`)
        .join(', ')}.`,
      rows: orphanPayments.map((p) => p.rowNumber),
    })
  }
  const orphanReports = reports.filter((r) => !references.has(r.reference))
  if (orphanReports.length > 0) {
    issues.push({
      kind: 'blocker',
      code: 'orphan_reports',
      message: `${plural(orphanReports.length, 'report row')} refers to a grant that is not on the Grants sheet`,
      detail: `Unmatched references: ${[...new Set(orphanReports.map((r) => r.reference))]
        .slice(0, 5)
        .map((r) => `“${r}”`)
        .join(', ')}.`,
      rows: orphanReports.map((r) => r.rowNumber),
    })
  }

  // ── Degradations ──

  const paymentsByRef = new Map<string, PaymentRow[]>()
  for (const p of payments) {
    const list = paymentsByRef.get(p.reference) ?? []
    list.push(p)
    paymentsByRef.set(p.reference, list)
  }
  const reportsByRef = new Map<string, ReportRow[]>()
  for (const r of reports) {
    const list = reportsByRef.get(r.reference) ?? []
    list.push(r)
    reportsByRef.set(r.reference, list)
  }

  // Payment schedules that don't add up to the award. Deliberately not a blocker —
  // part-scheduled grants are ordinary, and a foundation part-way through a cycle
  // often hasn't set the later years yet. But it is the single most common sign of a
  // mis-keyed figure, so it is stated in money terms rather than as a vague warning.
  const mismatched = grants.filter((g) => {
    const rows = paymentsByRef.get(g.reference)
    if (!rows || rows.length === 0) return false
    const total = rows.reduce((s, p) => s + p.amount, 0)
    return Math.abs(total - g.amountAwarded) > 1
  })
  if (mismatched.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'schedule_mismatch',
      message: `${plural(mismatched.length, 'grant')} where the payments don’t add up to the amount awarded`,
      detail:
        'Often deliberate — later years may not be scheduled yet. Worth a look though, as it is also what a mis-keyed figure looks like. Custodian will use the payment rows as the schedule and the award figure as the commitment.',
      rows: mismatched.map((g) => g.rowNumber),
    })
  }

  const activeNoPayments = grants.filter(
    (g) => g.status === 'active' && (paymentsByRef.get(g.reference)?.length ?? 0) === 0,
  )
  if (activeNoPayments.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'active_no_payments',
      message: `${plural(activeNoPayments.length, 'active grant')} with no payments listed`,
      detail:
        'These will show nothing outstanding on the Finance screen. If money is still to go out on them, add the instalments — this is the main thing the import is for.',
      rows: activeNoPayments.map((g) => g.rowNumber),
    })
  }

  const activeNoReports = grants.filter(
    (g) => g.status === 'active' && (reportsByRef.get(g.reference)?.length ?? 0) === 0,
  )
  if (activeNoReports.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'active_no_reports',
      message: `${plural(activeNoReports.length, 'active grant')} with no reporting milestones`,
      detail:
        'These will show as having nothing due. If you expect a report on them, add it to the Reports sheet so it appears on the Reports screen.',
      rows: activeNoReports.map((g) => g.rowNumber),
    })
  }

  // `expected` columns, each carrying its own cost — the same sentence the grant
  // itself will show once imported.
  for (const column of GRANT_COLUMNS.filter((c) => c.tier === 'expected')) {
    const missing = grants.filter(
      (g) => (g as unknown as Record<string, unknown>)[column.key] == null,
    )
    if (missing.length === 0) continue
    issues.push({
      kind: 'degradation',
      code: `missing_${column.key}`,
      message: `${plural(missing.length, 'grant')} with no ${columnLabel(column)}`,
      detail: column.degrades!,
      rows: missing.map((g) => g.rowNumber),
    })
  }

  // The one_of group: either registration number is fine, neither is not.
  for (const group of ONE_OF_GROUPS) {
    const missing = grants.filter((g) =>
      group.keys.every((k) => (g as unknown as Record<string, unknown>)[k] == null),
    )
    if (missing.length === 0) continue
    issues.push({
      kind: 'degradation',
      code: `missing_one_of_${group.keys.join('_')}`,
      message: `${plural(missing.length, 'grant')} with no ${group.label.toLowerCase()}`,
      detail: group.degrades,
      rows: missing.map((g) => g.rowNumber),
    })
  }

  const paidNoDate = payments.filter((p) => p.paid && !p.paidDate)
  if (paidNoDate.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'paid_no_date',
      message: `${plural(paidNoDate.length, 'payment')} marked paid with no date`,
      detail: paymentCol('paidDate').degrades!,
      rows: paidNoDate.map((p) => p.rowNumber),
    })
  }

  const missingReference = grants.filter((g) => !g.reference)
  if (missingReference.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'generated_reference',
      message: `${plural(missingReference.length, 'grant')} with no ${columnLabel(grantCol('reference'))}`,
      detail:
        'We will generate one for each. You will get the list afterwards — a charity needs to quote its reference for a future report to link itself automatically.',
      rows: missingReference.map((g) => g.rowNumber),
    })
  }

  // ── Reconciliation ──
  //
  // The three figures a finance lead already knows by heart. Everything else in the
  // flow is preparation for this screen: if these match their ledger they trust the
  // platform, and if they don't we find out before go-live rather than in a meeting.

  const totalCommitted = grants.reduce((s, g) => s + g.amountAwarded, 0)
  const paidRows = payments.filter((p) => p.paid && references.has(p.reference))
  const unpaidRows = payments.filter((p) => !p.paid && references.has(p.reference))
  const totalPaid = paidRows.reduce((s, p) => s + p.amount, 0)
  const totalOutstanding = unpaidRows.reduce((s, p) => s + p.amount, 0)

  const reconciliation: Reconciliation = {
    grants: grants.length,
    activeGrants: grants.filter((g) => g.status === 'active').length,
    completedGrants: grants.filter((g) => g.status === 'completed').length,
    payments: payments.length,
    reportMilestones: reports.length,
    totalCommitted,
    totalPaid,
    totalOutstanding,
    reportsOutstanding: reports.filter((r) => !r.receivedDate && references.has(r.reference))
      .length,
  }

  const blockers = issues.filter((i) => i.kind === 'blocker')

  return {
    issues: [...blockers, ...issues.filter((i) => i.kind === 'degradation')],
    reconciliation,
    canCommit: blockers.length === 0 && grants.length > 0,
  }
}
