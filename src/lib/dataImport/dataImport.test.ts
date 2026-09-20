import { describe, expect, it } from 'vitest'
import { matchValue, normalise, resolveColumn, similarity } from './match'
import {
  asCode,
  asDate,
  asNumber,
  parseGrants,
  parsePayments,
  parseReports,
  type RawRow,
} from './parse'
import { MAX_GRANTS_PER_IMPORT, validateImport } from './validate'
import type { GrantRow, PaymentRow, ReportRow } from './parse'

// ─── Matching ───────────────────────────────────────────────────────────────

describe('normalise', () => {
  it('folds the differences that are not real differences', () => {
    expect(normalise('  Community & Place  ')).toBe(normalise('community and place'))
    expect(normalise('Young People / Education')).toBe(normalise('young people education'))
    expect(normalise('Café Fund')).toBe(normalise('cafe fund'))
  })
})

describe('matchValue', () => {
  const candidates = [
    { id: 'p1', name: 'Community & Place' },
    { id: 'p2', name: 'Environment & Nature' },
    { id: 'p3', name: 'Young People & Education' },
  ]

  it('treats a normalisation-equal string as exact, so it applies without asking', () => {
    const result = matchValue('community and place ', candidates)
    expect(result.kind).toBe('exact')
    if (result.kind === 'exact') expect(result.candidate.id).toBe('p1')
  })

  it('suggests a close typo rather than applying it', () => {
    const result = matchValue('Comunity & Place', candidates)
    expect(result.kind).toBe('suggestion')
    if (result.kind === 'suggestion') expect(result.candidate.id).toBe('p1')
  })

  it('gives up rather than guessing when nothing is close', () => {
    expect(matchValue('Heritage Buildings', candidates).kind).toBe('none')
  })

  it('never matches an empty cell to anything', () => {
    expect(matchValue('   ', candidates).kind).toBe('none')
  })

  // The failure that motivates the threshold: two programmes sharing a prefix must
  // not have one of them confidently picked for the other.
  it('does not confidently pick between two near-identical names', () => {
    const twins = [
      { id: 'a', name: 'Youth Fund North' },
      { id: 'b', name: 'Youth Fund South' },
    ]
    const result = matchValue('Youth Fund', twins)
    if (result.kind === 'suggestion') {
      expect(similarity('Youth Fund', 'Youth Fund North')).toBeCloseTo(
        similarity('Youth Fund', 'Youth Fund South'),
        5,
      )
    }
  })
})

describe('resolveColumn', () => {
  it('groups by distinct value so one decision covers every row using it', () => {
    const values = ['Comunity & Place', 'Comunity & Place', 'Comunity & Place', 'Environment']
    const resolutions = resolveColumn(values, [{ id: 'p1', name: 'Community & Place' }])
    const first = resolutions[0]!
    expect(first.value).toBe('Comunity & Place')
    expect(first.rowCount).toBe(3)
    expect(first.reason).toBeTruthy()
  })
})

// ─── Cell coercion ──────────────────────────────────────────────────────────

describe('asNumber', () => {
  it('reads what people actually type', () => {
    expect(asNumber('£45,000')).toBe(45000)
    expect(asNumber('45000')).toBe(45000)
    expect(asNumber(45000)).toBe(45000)
    expect(asNumber('(1,200)')).toBe(-1200)
  })

  it('returns null rather than NaN for something unreadable', () => {
    expect(asNumber('about forty grand')).toBeNull()
    expect(asNumber('')).toBeNull()
    expect(asNumber(null)).toBeNull()
  })
})

describe('asCode', () => {
  // The whole reason this function exists: Excel's General format turns a sort code
  // into an integer the moment the cell is committed, and the leading zero is gone
  // before the file ever reaches us. An account number missing a zero fails the
  // modulus check and reads as a bad account rather than a lost digit.
  it('puts back the leading zeros Excel ate', () => {
    expect(asCode(123456, 8)).toBe('00123456')
    expect(asCode(10203, 6)).toBe('010203')
  })

  it('leaves a full-length or formatted value alone', () => {
    expect(asCode('00123456', 8)).toBe('00123456')
    expect(asCode('40-47-84', 6)).toBe('40-47-84')
    expect(asCode(404784, 6)).toBe('404784')
  })

  it('reads a blank cell as nothing to check', () => {
    expect(asCode(null, 8)).toBeNull()
    expect(asCode('', 8)).toBeNull()
    expect(asCode('   ', 8)).toBeNull()
  })
})

describe('asDate', () => {
  it('accepts ISO and real Date cells', () => {
    expect(asDate('2025-06-01').iso).toBe('2025-06-01')
    expect(asDate(new Date(Date.UTC(2025, 5, 1))).iso).toBe('2025-06-01')
  })

  // Guessing here would misdate a payment by a month with nothing on screen to show
  // for it, so an ambiguous slash date is refused rather than interpreted.
  it('refuses an ambiguous slash date instead of guessing', () => {
    const result = asDate('03/04/2025')
    expect(result.iso).toBeNull()
    expect(result.ambiguous).toBe(true)
  })

  it('accepts a slash date that can only be read one way', () => {
    expect(asDate('23/04/2025').iso).toBe('2025-04-23')
  })
})

// ─── Parsing ────────────────────────────────────────────────────────────────

const grantCells = (over: Record<string, unknown> = {}): RawRow => ({
  rowNumber: 2,
  cells: {
    reference: 'GR-001',
    organisationName: 'Pennine Youth Alliance',
    programme: 'Community & Place',
    round: 'Spring 2025',
    awardDate: '2025-06-01',
    amountAwarded: 45000,
    status: 'Active',
    ...over,
  },
})

describe('parseGrants', () => {
  it('builds a row from a well-formed line', () => {
    const { rows, issues } = parseGrants([grantCells()])
    expect(issues).toHaveLength(0)
    expect(rows[0]!.amountAwarded).toBe(45000)
    expect(rows[0]!.status).toBe('active')
  })

  it('reports a missing required cell rather than importing a half-row', () => {
    const { rows, issues } = parseGrants([grantCells({ organisationName: '  ' })])
    expect(rows).toHaveLength(0)
    expect(issues.some((i) => i.message.includes('Organisation name'))).toBe(true)
  })

  it('keeps a grant with no reference — we mint one at commit', () => {
    const { rows, issues } = parseGrants([grantCells({ reference: '' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.reference).toBe('')
    expect(issues).toHaveLength(0)
  })
})

describe('parsePayments', () => {
  it('refuses a payment with no due date', () => {
    const { rows, issues } = parsePayments([
      { rowNumber: 2, cells: { reference: 'GR-001', amount: 100, paid: 'No' } },
    ])
    expect(rows).toEqual([])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ rowNumber: 2, column: 'Due date' })
  })

  it('reads Yes/No into a boolean', () => {
    const { rows } = parsePayments([
      {
        rowNumber: 2,
        cells: { reference: 'GR-001', amount: 100, paid: 'Yes', dueDate: '2025-06-01' },
      },
    ])
    expect(rows[0]!.paid).toBe(true)
  })
})

describe('parseReports', () => {
  const cells = (over: Record<string, unknown> = {}) => ({
    rowNumber: 2,
    cells: { reference: 'GR-001', label: 'Final report', dueDate: '2026-06-01', ...over },
  })

  it('reads the Received? answer', () => {
    expect(parseReports([cells({ received: 'Yes' })]).rows[0]!.received).toBe(true)
    expect(parseReports([cells({ received: 'No' })]).rows[0]!.received).toBe(false)
  })

  it('treats a blank answer as not received', () => {
    expect(parseReports([cells()]).rows[0]!.received).toBe(false)
  })

  // A v1 workbook has no Received? column at all, so the date is the only evidence
  // there is — and a report cannot have arrived on a day and also not have arrived.
  it('lets a date stand in for the answer, and override a No', () => {
    expect(parseReports([cells({ receivedDate: '2026-05-20' })]).rows[0]!.received).toBe(true)
    expect(
      parseReports([cells({ received: 'No', receivedDate: '2026-05-20' })]).rows[0]!.received,
    ).toBe(true)
  })
})

// ─── Validation ─────────────────────────────────────────────────────────────

const grant = (over: Partial<GrantRow> = {}): GrantRow => ({
  rowNumber: 2,
  reference: 'GR-001',
  organisationName: 'Pennine Youth Alliance',
  programme: 'Community & Place',
  round: 'Spring 2025',
  awardDate: '2025-06-01',
  amountAwarded: 45000,
  amountPaid: null,
  status: 'active',
  charityNumber: '1122334',
  companyNumber: null,
  contactEmail: 'hello@pya.org.uk',
  deliveryArea: 'Calderdale',
  purpose: 'Youth work',
  themes: [],
  endDate: null,
  impactQuantity: null,
  // The fixture grant pays in full on award, so it owes nothing and needs no account.
  // `bank_details_missing` only looks at grants with an unpaid instalment.
  bankAccountName: null,
  bankSortCode: null,
  bankAccountNumber: null,
  ...over,
})

const payment = (over: Partial<PaymentRow> = {}): PaymentRow => ({
  rowNumber: 2,
  reference: 'GR-001',
  dueDate: '2025-06-01',
  amount: 45000,
  paid: true,
  paidDate: '2025-06-01',
  ...over,
})

const report = (over: Partial<ReportRow> = {}): ReportRow => ({
  rowNumber: 2,
  reference: 'GR-001',
  label: 'Final report',
  dueDate: '2026-06-01',
  received: false,
  receivedDate: null,
  ...over,
})

const run = (over: Partial<Parameters<typeof validateImport>[0]> = {}) =>
  validateImport({ grants: [], payments: [], reports: [], cellIssues: [], ...over })

describe('validateImport', () => {
  it('reconciles the three figures a finance lead checks', () => {
    const result = run({
      grants: [grant(), grant({ rowNumber: 3, reference: 'GR-002', amountAwarded: 20000 })],
      payments: [
        payment(),
        payment({ rowNumber: 3, reference: 'GR-002', amount: 20000, paid: false, paidDate: null }),
      ],
    })
    expect(result.reconciliation.totalCommitted).toBe(65000)
    expect(result.reconciliation.totalPaid).toBe(45000)
    expect(result.reconciliation.totalOutstanding).toBe(20000)
  })

  // The write path is one `db.batch` under a 4-second timeout, so this is a measured
  // limit rather than a preference. Said on the review screen because the alternative
  // is a database error after a foundation has matched every value and confirmed.
  it('blocks a workbook with more grants than one import can write', () => {
    const many = Array.from({ length: MAX_GRANTS_PER_IMPORT + 1 }, (_, i) =>
      grant({ reference: `G${i}` }),
    )
    const result = validateImport({ grants: many, payments: [], reports: [], cellIssues: [] })
    expect(result.canCommit).toBe(false)
    expect(result.issues.find((i) => i.code === 'too_many_grants')?.detail).toContain('Split it')
  })

  it('says nothing about size for a workbook that fits', () => {
    const result = validateImport({
      grants: [grant({ reference: 'G1' })],
      payments: [],
      reports: [],
      cellIssues: [],
    })
    expect(result.issues.some((i) => i.code === 'too_many_grants')).toBe(false)
  })

  it('blocks a duplicate reference — payments join on it, so a repeat is ambiguous', () => {
    const result = run({ grants: [grant(), grant({ rowNumber: 3 })] })
    expect(result.canCommit).toBe(false)
    expect(result.issues.some((i) => i.code === 'duplicate_reference')).toBe(true)
  })

  it('blocks a payment pointing at a grant that is not in the file', () => {
    const result = run({ grants: [grant()], payments: [payment({ reference: 'GR-999' })] })
    expect(result.canCommit).toBe(false)
    expect(result.issues.some((i) => i.code === 'orphan_payments')).toBe(true)
  })

  // The whole point of the middle tier: a missing delivery area costs something real,
  // and must be stated — but holding a foundation's entire portfolio over it would be
  // disproportionate.
  it('reports a missing delivery area as a degradation, not a blocker', () => {
    const result = run({ grants: [grant({ deliveryArea: null })] })
    expect(result.canCommit).toBe(true)
    const issue = result.issues.find((i) => i.code === 'missing_deliveryArea')
    expect(issue?.kind).toBe('degradation')
    expect(issue?.detail).toContain('deprivation')
  })

  it('reports having neither registration number, since due diligence can never run', () => {
    const result = run({ grants: [grant({ charityNumber: null, companyNumber: null })] })
    expect(result.canCommit).toBe(true)
    const issue = result.issues.find((i) => i.code.startsWith('missing_one_of'))
    expect(issue?.kind).toBe('degradation')
  })

  it('accepts either registration number on its own', () => {
    const result = run({
      grants: [grant({ charityNumber: null, companyNumber: '09876543' })],
    })
    expect(result.issues.some((i) => i.code.startsWith('missing_one_of'))).toBe(false)
  })

  it('flags a payment schedule that does not add up, without blocking it', () => {
    const result = run({ grants: [grant()], payments: [payment({ amount: 30000 })] })
    expect(result.canCommit).toBe(true)
    expect(result.issues.some((i) => i.code === 'schedule_mismatch')).toBe(true)
  })

  it('flags an active grant with nothing scheduled — the main thing the import is for', () => {
    const result = run({ grants: [grant()] })
    expect(result.issues.some((i) => i.code === 'active_no_payments')).toBe(true)
    expect(result.issues.some((i) => i.code === 'active_no_reports')).toBe(true)
  })

  // Scoped to the grants that still owe money. A back catalogue is mostly closed
  // grants that need no account number, and warning about those would bury the
  // handful somebody has to go and find bank details for.
  it('asks for bank details only where an instalment is still unpaid', () => {
    const owing = run({
      grants: [grant()],
      payments: [payment({ paid: false, paidDate: null })],
    })
    expect(owing.issues.some((i) => i.code === 'bank_details_missing')).toBe(true)
    expect(owing.canCommit).toBe(true)

    const settled = run({ grants: [grant({ status: 'completed' })], payments: [payment()] })
    expect(settled.issues.some((i) => i.code === 'bank_details_missing')).toBe(false)
  })

  it('says nothing about bank details once they are filled in', () => {
    const result = run({
      grants: [grant({ bankSortCode: '40-47-84', bankAccountNumber: '70872490' })],
      payments: [payment({ paid: false, paidDate: null })],
    })
    expect(result.issues.some((i) => i.code === 'bank_details_missing')).toBe(false)
  })

  // A cancelled grant is not going to be paid, whatever its schedule still says.
  it('does not ask for bank details on a cancelled grant', () => {
    const result = run({
      grants: [grant({ status: 'cancelled' })],
      payments: [payment({ paid: false, paidDate: null })],
    })
    expect(result.issues.some((i) => i.code === 'bank_details_missing')).toBe(false)
  })

  it('counts an unreceived milestone as outstanding', () => {
    const result = run({ grants: [grant()], reports: [report()] })
    expect(result.reconciliation.reportsOutstanding).toBe(1)
  })

  // A foundation that logged which reports came in but never their dates would
  // otherwise see every milestone it ever met listed as overdue.
  it('takes a report’s Received? answer, not its date, as what settles it', () => {
    const result = run({
      grants: [grant()],
      reports: [report({ received: true, receivedDate: null })],
    })
    expect(result.reconciliation.reportsOutstanding).toBe(0)
    expect(result.issues.some((i) => i.code === 'received_no_date')).toBe(true)
  })

  // ── The lump "Amount paid" figure ──

  it('counts a completed grant’s lump sum as paid when it has no instalments', () => {
    const result = run({
      grants: [grant({ status: 'completed', amountPaid: 45000 })],
    })
    expect(result.reconciliation.totalPaid).toBe(45000)
    expect(result.reconciliation.totalOutstanding).toBe(0)
  })

  // Counting both would double the paid total on every grant that filled in each — and
  // the schedule is the only one of the two that says what went out when.
  it('ignores the lump sum where instalments were listed, and says so', () => {
    const result = run({
      grants: [grant({ amountPaid: 10000 })],
      payments: [payment()],
    })
    expect(result.reconciliation.totalPaid).toBe(45000)
    const issue = result.issues.find((i) => i.code === 'amount_paid_mismatch')
    expect(issue?.kind).toBe('degradation')
  })

  it('flags a completed grant with nothing recorded as paid', () => {
    const result = run({ grants: [grant({ status: 'completed' })] })
    expect(result.canCommit).toBe(true)
    expect(result.issues.some((i) => i.code === 'completed_nothing_paid')).toBe(true)
  })

  // Re-uploading is the phasing mechanism (live grants first, historic later), so a
  // reference from a previous import must update rather than collide.
  it('allows a reference that a previous import created', () => {
    const result = run({
      grants: [grant()],
      existingReferences: [{ reference: 'GR-001', importedByBatch: true }],
    })
    expect(result.issues.some((i) => i.code === 'reference_in_use')).toBe(false)
  })

  it('blocks a reference belonging to a grant created in Custodian', () => {
    const result = run({
      grants: [grant()],
      existingReferences: [{ reference: 'GR-001', importedByBatch: false }],
    })
    expect(result.canCommit).toBe(false)
    expect(result.issues.some((i) => i.code === 'reference_in_use')).toBe(true)
  })

  it('groups repeated cell errors into one line rather than forty', () => {
    const cellIssues = Array.from({ length: 40 }, (_, i) => ({
      rowNumber: i + 2,
      column: 'Award date',
      message: 'Award date is not a date we can read. Use YYYY-MM-DD',
    }))
    const result = run({ grants: [grant()], cellIssues })
    const grouped = result.issues.filter((i) => i.code === 'cell')
    expect(grouped).toHaveLength(1)
    expect(grouped[0]!.rows).toHaveLength(40)
  })

  it('refuses an empty workbook', () => {
    expect(run().canCommit).toBe(false)
  })
})
