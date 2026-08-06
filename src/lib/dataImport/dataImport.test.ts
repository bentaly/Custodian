import { describe, expect, it } from 'vitest'
import { matchValue, normalise, resolveColumn, similarity } from './match'
import { asDate, asNumber, parseGrants, parsePayments, type RawRow } from './parse'
import { validateImport } from './validate'
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

// ─── Validation ─────────────────────────────────────────────────────────────

const grant = (over: Partial<GrantRow> = {}): GrantRow => ({
  rowNumber: 2,
  reference: 'GR-001',
  organisationName: 'Pennine Youth Alliance',
  programme: 'Community & Place',
  round: 'Spring 2025',
  awardDate: '2025-06-01',
  amountAwarded: 45000,
  status: 'active',
  charityNumber: '1122334',
  companyNumber: null,
  contactEmail: 'hello@pya.org.uk',
  deliveryArea: 'Calderdale',
  purpose: 'Youth work',
  endDate: null,
  impactQuantity: null,
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

  it('counts an unreceived milestone as outstanding', () => {
    const result = run({ grants: [grant()], reports: [report()] })
    expect(result.reconciliation.reportsOutstanding).toBe(1)
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
      message: 'Award date is not a date we can read — use YYYY-MM-DD',
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
