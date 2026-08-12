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

  // ── The lump "Amount paid" figure ──
  //
  // Completed grants are filled in on the Grants sheet alone (see the template's
  // instructions), so their money arrives as one total rather than as instalments. The
  // itemised rows always win where both exist: a schedule is what Finance reconciles
  // against, and a single figure cannot say what went out when.
  const lumpMismatch = grants.filter((g) => {
    const rows = paymentsByRef.get(g.reference)
    if (!rows || rows.length === 0 || g.amountPaid == null) return false
    const paid = rows.filter((p) => p.paid).reduce((s, p) => s + p.amount, 0)
    return Math.abs(paid - g.amountPaid) > 1
  })
  if (lumpMismatch.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'amount_paid_mismatch',
      message: `${plural(lumpMismatch.length, 'grant')} where ‘Amount paid’ disagrees with the payments listed`,
      detail:
        'Custodian will use the payment rows, since they are the only thing that says what went out and when. Check the total if you were reconciling against it.',
      rows: lumpMismatch.map((g) => g.rowNumber),
    })
  }

  const nothingPaid = grants.filter(
    (g) =>
      g.status === 'completed' &&
      (paymentsByRef.get(g.reference)?.length ?? 0) === 0 &&
      (g.amountPaid == null || g.amountPaid === 0),
  )
  if (nothingPaid.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'completed_nothing_paid',
      message: `${plural(nothingPaid.length, 'completed grant')} with nothing recorded as paid`,
      detail:
        'These will show as £0 paid, so your lifetime giving total will be short by their value. Put the total that went out in ‘Amount paid’, or itemise the instalments on the Payments sheet.',
      rows: nothingPaid.map((g) => g.rowNumber),
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

  // The report-side twin of `paid_no_date`, and it loses the same thing: the milestone
  // counts as met, but it cannot be placed on a timeline.
  const receivedNoDate = reports.filter((r) => r.received && !r.receivedDate)
  if (receivedNoDate.length > 0) {
    issues.push({
      kind: 'degradation',
      code: 'received_no_date',
      message: `${plural(receivedNoDate.length, 'report')} marked received with no date`,
      detail:
        'These count as received — the milestone will not show as outstanding — but they carry the due date as their arrival date, so how late a report was is lost.',
      rows: receivedNoDate.map((r) => r.rowNumber),
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
  // Lump sums count only where there is no schedule to count instead, which is the same
  // rule the commit path uses to decide whether to write one. If the two disagreed, the
  // total a finance lead signed off here would not be the total they saw afterwards.
  const lumpPaid = grants
    .filter((g) => (paymentsByRef.get(g.reference)?.length ?? 0) === 0)
    .reduce((s, g) => s + (g.amountPaid ?? 0), 0)
  const totalPaid = paidRows.reduce((s, p) => s + p.amount, 0) + lumpPaid
  // Nothing is outstanding on a grant with no schedule: there is no instalment to be
  // waiting for. An unpaid balance on a completed grant is history, not a debt.
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
    reportsOutstanding: reports.filter((r) => !r.received && references.has(r.reference)).length,
  }

  const blockers = issues.filter((i) => i.kind === 'blocker')

  return {
    issues: [...blockers, ...issues.filter((i) => i.kind === 'degradation')],
    reconciliation,
    canCommit: blockers.length === 0 && grants.length > 0,
  }
}
