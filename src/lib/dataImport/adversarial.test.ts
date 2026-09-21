// ─── Adversarial workbooks ──────────────────────────────────────────────────
//
// The other suites here test the file we hand out being filled in the way we asked.
// This one tests the file that comes back from a foundation's finance officer, who
// has a decade of grants in a spreadsheet of their own and thirty minutes to spare:
// dates Excel rewrote on the way in, money with a currency symbol and a stray comma,
// a reference column their old system generated, a cancelled grant nobody removed.
//
// The line every test here is drawn against is the one the module states for itself:
// a lost or mis-read value must never be indistinguishable from a question the
// foundation never asked. A refusal is a good outcome. A warning is a good outcome.
// A figure quietly a hundred times too big is not.
//
// Six of these were written as failing tests and are now the fix's regression guard.
// Each carries the date and the reason, so the rule can be read without the diff.

import { describe, expect, it } from 'vitest'
import { matchValue, resolveColumn } from './match'
import {
  asCode,
  asDate,
  asNumber,
  parseGrants,
  parsePayments,
  parseReports,
  splitThemes,
  type GrantRow,
  type PaymentRow,
  type RawRow,
  type ReportRow,
} from './parse'
import { grantThemes, type ProgrammeWithThemes } from './themes'
import { validateImport } from './validate'

// ─── Fixtures ───────────────────────────────────────────────────────────────

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
  durationYears: null,
  impactQuantity: null,
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

// ─── Dates ──────────────────────────────────────────────────────────────────

describe('dates Excel or a person rewrote on the way in', () => {
  // A date-formatted cell pasted into a General column arrives as its serial number,
  // and 45810 is a plausible-looking figure that must never be read as one. Refused
  // with a message, which is the right answer: there is no way to tell a serial from
  // an impact figure once it is in a date column.
  it('refuses an Excel serial number rather than reading it as a date', () => {
    expect(asDate(45810)).toEqual({ iso: null, ambiguous: false })

    const { rows, issues } = parseGrants([grantCells({ awardDate: 45810 })])
    expect(rows).toHaveLength(0)
    expect(issues[0]!.message).toContain('not a date we can read')
  })

  // "01/06/25" is how half the world writes dates and there is no reading of it that
  // is safe: day/month/year and month/day/year are both live, and the century is a
  // guess on top. Refused outright rather than half-guessed.
  it('refuses a two-digit year outright', () => {
    expect(asDate('01/06/25').iso).toBeNull()
    expect(asDate('1.6.25').iso).toBeNull()
  })

  // A date column holding text with a time on the end: refused, with the "use
  // YYYY-MM-DD" message. Pinned because the fix is obvious to the person reading it,
  // where a silently truncated time would not be.
  it('refuses an ISO date carrying a time', () => {
    expect(asDate('2025-06-01 09:30').iso).toBeNull()
    expect(asDate('2025-06-01T09:30:00Z').iso).toBeNull()
  })

  // 30 February is not a date, and neither is 31 April, but until 2026-09-20 both passed
  // the range check (day <= 31) and came out as ISO strings everything downstream
  // treated as real. Two different wrong answers follow from one cell: `new Date(
  // '2025-02-30T00:00:00Z')` silently rolls over to 2 March, which is what the award's
  // `decisionAt` gets, while Postgres refuses the same string outright for a `date`
  // column, so the import dies at the write with no row named. Both are what this
  // function exists to prevent: it already refuses an ambiguous date rather than
  // picking one. It should refuse an impossible one the same way, so it lands as a
  // cell issue on the review screen beside the row number that carries it.
  it('refuses a date that does not exist', () => {
    expect(asDate('2025-02-30').iso).toBeNull()
    expect(asDate('2025-04-31').iso).toBeNull()
    // The slashed branch has the same hole, reached from the other direction: "31" is
    // over 12 so the date reads as unambiguously British, and April has 30 days.
    expect(asDate('31/04/2025').iso).toBeNull()
  })

  // Not a defect on its own, but worth pinning: nothing checks that a grant's end date
  // follows its award date. It matters more than it looks, because a completed grant
  // with no payment rows has its whole "Amount paid" written as ONE instalment dated at
  // the end date, so a transposed pair puts the money in a financial year before the
  // grant was made, where Balance & budget will count it.
  it('says nothing when a grant ends before it was awarded', () => {
    const result = run({
      grants: [grant({ status: 'completed', amountPaid: 45000, endDate: '2019-06-01' })],
    })
    expect(result.canCommit).toBe(true)
    // Not a word, anywhere: the row raises no issue of any kind.
    expect(result.issues).toEqual([])
  })
})

// ─── Money ──────────────────────────────────────────────────────────────────

describe('money as a finance officer types it', () => {
  it('reads a currency symbol, thousands separators and a trailing space', () => {
    expect(asNumber('£1,234.56')).toBe(1234.56)
    expect(asNumber(' 45000 ')).toBe(45000)
    expect(asNumber('45 000')).toBe(45000)
  })

  // A formula result is what most "total" columns actually contain. ExcelJS hands the
  // cell over as an object, and the computed value is what we want, not the formula.
  it('reads a formula cell as its result', () => {
    expect(asNumber({ formula: 'B2*3', result: 45000 })).toBe(45000)
    // A formula that errored has no number in it, so it is refused rather than zeroed.
    expect(asNumber({ formula: 'B2/0', result: { error: '#DIV/0!' } })).toBeNull()
  })

  // Refusing is right: a number we cannot read must not become one we invented.
  it('refuses shorthand and prose rather than guessing at it', () => {
    expect(asNumber('1.2k')).toBeNull()
    expect(asNumber('45,000 approx')).toBeNull()
    expect(asNumber('tbc')).toBeNull()
  })

  it('refuses a negative award, however it was written', () => {
    const { issues } = parseGrants([grantCells({ amountAwarded: '(45,000)' })])
    expect(issues.some((i) => i.message === 'Amount awarded cannot be negative')).toBe(true)
  })

  // Both money columns on the Grants sheet refuse a negative figure; until 2026-09-20 the
  // money column on the Payments sheet did not, and a refund or clawback keyed as a negative
  // instalment is exactly how a foundation records one in their own ledger. It imports
  // as an `award_instalments` row for minus five thousand pounds, which nothing else in
  // Custodian can produce: every other writer goes through `buildSchedule`, whose split
  // is checked against the award. Once in, it silently reduces both the paid total and
  // the outstanding total on Finance. The same rule as the Grants sheet is wanted here:
  // refuse it as a cell issue and let the foundation say what they meant.
  it('refuses a negative instalment as it refuses a negative award', () => {
    const { rows, issues } = parsePayments([
      {
        rowNumber: 2,
        cells: { reference: 'GR-001', amount: '(5,000)', paid: 'Yes', dueDate: '2025-06-01' },
      },
    ])
    expect(issues.some((i) => /negative/i.test(i.message))).toBe(true)
    expect(rows).toHaveLength(0)
  })

  // Documented, not asserted as wrong, because a continental figure in a British
  // foundation's workbook is rare. It is silent in both directions when it does happen:
  // the comma is always stripped as a thousands separator, so "1 234,56" reads a
  // hundred times too big and "1.234,56" reads a thousand times too small. Neither is
  // refused, and nothing downstream can tell either from a figure somebody meant.
  it('reads a comma used as a decimal point as a different figure entirely', () => {
    expect(asNumber('1 234,56')).toBe(123456)
    expect(asNumber('1.234,56')).toBe(1.23456)
  })

  // The itemised version of this IS warned about (`amount_paid_mismatch`), and the
  // itemised version that overshoots the award is warned about too
  // (`schedule_mismatch`). The lump-sum version is silent: a completed grant whose
  // "Amount paid" carries one digit too many imports as £450,000 paid against a £45,000
  // award, and the only place it shows is the reconciliation total a finance lead is
  // asked to eyeball. Worth a degradation of its own on the same reasoning the other
  // two carry: it is what a mis-keyed figure looks like.
  it('says nothing when the lump ‘Amount paid’ is larger than the award', () => {
    const result = run({
      grants: [grant({ status: 'completed', amountPaid: 450000 })],
    })
    expect(result.canCommit).toBe(true)
    expect(result.issues.some((i) => i.code === 'amount_paid_mismatch')).toBe(false)
    expect(result.reconciliation.totalPaid).toBe(450000)
    expect(result.reconciliation.totalCommitted).toBe(45000)
  })

  // Pasted-twice payment rows are visible, though under a message about the schedule
  // not adding up rather than about duplication. Pinned because it is the check that
  // catches both a duplicate and an overpayment, and it must not be weakened.
  it('catches a payment row pasted twice through the schedule total', () => {
    const result = run({
      grants: [grant()],
      payments: [payment(), payment({ rowNumber: 3 })],
    })
    expect(result.issues.some((i) => i.code === 'schedule_mismatch')).toBe(true)
    expect(result.reconciliation.totalPaid).toBe(90000)
  })
})

// ─── Registration numbers and bank codes ────────────────────────────────────

describe('codes that look like numbers', () => {
  it('leaves a Scottish, Northern Irish or letter-prefixed number alone', () => {
    expect(asCode('SC012345', 8)).toBe('SC012345')
    expect(asCode('NIC101234', 8)).toBe('NIC101234')
    expect(asCode('OC301234', 8)).toBe('OC301234')
  })

  // The bank columns are rescued from Excel's General format; the two registration
  // columns are not, because they go through `asText`. A company number is where that
  // costs something: numbers below 10,000,000 are published zero-padded ("00612172"),
  // and one typed into a General cell arrives here as 612172 and is stored that way.
  // Due diligence re-pads before it calls Companies House (`normaliseCompanyNumber`),
  // so the check itself still runs, which is why this is documented rather than failed
  // — but the value on the grant, the one a person reads and an incoming report is
  // matched against, is the truncated one.
  it('does not put back the leading zeros on a company number', () => {
    const { rows } = parseGrants([grantCells({ companyNumber: 612172, charityNumber: null })])
    expect(rows[0]!.companyNumber).toBe('612172')
    // What the bank columns do with the identical input, one column to the right.
    expect(asCode(612172, 8)).toBe('00612172')
  })
})

// ─── Text cells that are not text ───────────────────────────────────────────

describe('a cell Excel decided was something else', () => {
  // References of the form "Mar-19" or "3-2019" are ordinary in a foundation's own
  // ledger, and Excel converts both to dates on entry. `asText` has no branch for a
  // Date, so the cell reads as EMPTY — and an empty reference is legitimate (we mint
  // one), so the grant is silently renumbered IMP-0001 and every payment and report
  // row quoting the old reference is orphaned. The orphans block, so the import does
  // not proceed quietly; what is silent is the cause, since nothing says the reference
  // column was read as blank.
  it('reads a reference Excel turned into a date as no reference at all', () => {
    const { rows, issues } = parseGrants([
      grantCells({ reference: new Date(Date.UTC(2019, 2, 1)) }),
    ])
    expect(rows[0]!.reference).toBe('')
    expect(issues).toHaveLength(0)
  })

  // The same coercion on a REQUIRED text column is caught, which is the contrast that
  // makes the case above worth reading.
  it('catches the same thing on a required column', () => {
    const { rows, issues } = parseGrants([
      grantCells({ organisationName: new Date(Date.UTC(2019, 2, 1)) }),
    ])
    expect(rows).toHaveLength(0)
    expect(issues.some((i) => i.message.includes('Organisation name'))).toBe(true)
  })
})

// ─── Status, and the money rule ─────────────────────────────────────────────
//
// The reconciliation panel prints "Total committed", "Paid to date" and "Still to pay"
// — the three words the money rule is written in — and asks a finance lead to check
// them against their own accounts. So they have to mean here what they mean on every
// screen the import feeds: paid INCLUDES cancelled, committed and outstanding EXCLUDE
// it. A cancelled grant left in the workbook is not an exotic input; it is what a
// foundation's own register looks like.

describe('a cancelled grant in the workbook', () => {
  const cancelled = () => ({
    grants: [
      grant({ status: 'cancelled', amountAwarded: 45000 }),
      grant({ rowNumber: 3, reference: 'GR-002', amountAwarded: 20000 }),
    ],
    payments: [
      payment({ amount: 15000 }),
      payment({ rowNumber: 3, amount: 30000, paid: false, paidDate: null }),
      payment({ rowNumber: 4, reference: 'GR-002', amount: 20000, paid: false, paidDate: null }),
    ],
    reports: [report(), report({ rowNumber: 3, reference: 'GR-002' })],
  })

  // Right, and the half of the rule that is easy to get wrong the other way: the money
  // left the building, so paid history has to reconcile against the foundation's ledger
  // whatever happened to the grant afterwards.
  it('counts what was paid before it was cancelled', () => {
    expect(run(cancelled()).reconciliation.totalPaid).toBe(15000)
  })

  // £30,000 of a withdrawn grant's schedule used to be counted as "Still to pay". There
  // is nothing left to pay: the grant was cancelled. Finance, the dashboard and the
  // Monday payments digest all exclude cancelled awards from outstanding, so the first
  // figure a foundation sees after importing disagrees with the one they signed off on
  // the screen before — and disagrees in the direction that makes them think Custodian
  // has invented a liability. The check immediately above this in validate.ts
  // (`bank_details_missing`) already excludes cancelled for exactly this reason.
  it('does not count a cancelled grant’s unpaid instalments as still to pay', () => {
    expect(run(cancelled()).reconciliation.totalOutstanding).toBe(20000)
  })

  // The same rule applied to work rather than to money, which is the form it has now been
  // missed in twice: `outstandingQuery`, `getDashboard` and
  // `reportDigestWindow` were all fixed to exclude cancelled grants from what is still
  // waited on, and this is the fourth place asking that question. A withdrawn grant owes
  // no report, so "Reports outstanding: 2" over a portfolio with one live grant is both
  // wrong and, once imported, contradicted by the Reports screen.
  it('does not count a cancelled grant’s milestone as a report outstanding', () => {
    expect(run(cancelled()).reconciliation.reportsOutstanding).toBe(1)
  })

  // "Total committed" used to include the whole £45,000 of the cancelled grant. A
  // withdrawn grant is not money committed; in a rollup the word means `max(committed,
  // paid)` per grant, so this one counts for the £15,000 that actually went out and the
  // headline should read £35,000. As it stands the number a finance lead checks against
  // their accounts is £20,500 higher than Insights and the Awards register will report
  // for the identical data an hour later.
  it('counts a cancelled grant only for what was paid on it', () => {
    expect(run(cancelled()).reconciliation.totalCommitted).toBe(35000)
  })

  it('reads a status in any case, and the American spelling', () => {
    expect(parseGrants([grantCells({ status: 'CANCELED ' })]).rows[0]!.status).toBe('cancelled')
    expect(parseGrants([grantCells({ status: 'complete' })]).rows[0]!.status).toBe('completed')
  })

  // A status nobody can read is a blocker rather than a default, which is the right
  // way round: "Withdrawn" silently becoming "Active" would put a dead grant back on
  // the payment schedule.
  it('refuses a status it does not recognise rather than defaulting one', () => {
    const { rows, issues } = parseGrants([grantCells({ status: 'Withdrawn' })])
    expect(rows).toHaveLength(0)
    expect(issues.some((i) => i.message.includes('Status must be'))).toBe(true)
  })
})

// ─── The Received? answer ───────────────────────────────────────────────────

describe('a Received? cell nobody can read', () => {
  // "Paid?" and "Received?" are the same kind of cell, and an unreadable value used to be
  // treated in opposite ways: "Part" in Paid? is a cell issue that blocks the import
  // until somebody says which it is, while "Received" (or "Y - late", or a tick) in
  // Received? was dropped to `false` with nothing said anywhere. That was precisely the
  // failure the column was added to fix: a foundation that logged which reports it held
  // saw every one of them imported as outstanding, then overdue, and could not tell why
  // the column it had filled in was ignored. A non-empty value we cannot read is now a
  // cell issue, exactly as on the Payments sheet. A blank cell keeps its old meaning,
  // which is a complete answer of "not received" and is how a v1 workbook reads.
  it('reports an unreadable Received? answer instead of reading it as No', () => {
    const { rows, issues } = parseReports([
      {
        rowNumber: 2,
        cells: {
          reference: 'GR-001',
          label: 'Final report',
          dueDate: '2026-06-01',
          received: 'Received',
        },
      },
    ])
    expect(issues.some((i) => i.column === 'Received?')).toBe(true)
    expect(rows[0]?.received).not.toBe(false)
  })

  // The contrast, on the sheet that gets it right.
  it('blocks an unreadable Paid? answer', () => {
    const { rows, issues } = parsePayments([
      {
        rowNumber: 2,
        cells: { reference: 'GR-001', amount: 100, paid: 'Part', dueDate: '2025-06-01' },
      },
    ])
    expect(rows).toHaveLength(0)
    expect(issues.some((i) => i.message.includes('Paid? must be Yes or No'))).toBe(true)
  })
})

// ─── References ─────────────────────────────────────────────────────────────

describe('references that collide', () => {
  // The duplicate check compares references BYTE for byte, while the check for a
  // reference already in use compares them lower-cased, and so does the commit path
  // when it decides which grants a re-upload replaces. So "GR-001" and "gr-001" in one
  // file are two grants here and one grant there. What the foundation meant is not in
  // doubt: it is the same grant typed twice, which is what `duplicate_reference` exists
  // to catch. Documented rather than failed because the fix has to be the same fold in
  // both places, and the fold is a decision about the join key, not about this check.
  it('does not see two references that differ only in case as a duplicate', () => {
    const result = run({
      grants: [grant(), grant({ rowNumber: 3, reference: 'gr-001' })],
    })
    expect(result.issues.some((i) => i.code === 'duplicate_reference')).toBe(false)
    expect(result.canCommit).toBe(true)
  })

  // The other side of the same fold, and it is a hard stop: a payment sheet whose
  // reference column was typed in a different case than the grants sheet blocks the
  // whole import. Safe, but the message sends somebody hunting for a grant that is
  // sitting right there.
  it('treats a payment reference in a different case as pointing at nothing', () => {
    const result = run({ grants: [grant()], payments: [payment({ reference: 'gr-001' })] })
    expect(result.canCommit).toBe(false)
    expect(result.issues.some((i) => i.code === 'orphan_payments')).toBe(true)
  })

  // A foundation with no references of its own is given IMP-0001 upwards, and is shown
  // the list afterwards so they can put it in their own records. The obvious next thing
  // they do is paste those references into the workbook for the grants they have
  // checked, leaving the rest blank, and re-upload.
  //
  // Nothing here objects, and nothing downstream does either: the minter skips only
  // references already held in Custodian that are NOT in the incoming file, so a stated
  // "IMP-0001" removes itself from the list of names to avoid and is handed straight
  // back out to the first blank row. `applications.external_application_id` carries no
  // unique constraint, so the result is two grants wearing one reference, with every
  // future re-upload, every report auto-link and every payment join now ambiguous.
  // The file is the one place that collision can be seen, which is why it is pinned
  // here: `duplicate_reference` should count the references the import is about to
  // mint, or the minter should avoid every reference stated in the file.
  it('allows a stated IMP- reference beside the blank rows it will be minted for', () => {
    const result = run({
      grants: [
        grant({ reference: 'IMP-0001' }),
        grant({ rowNumber: 3, reference: '', organisationName: 'Calder Valley Arts' }),
      ],
    })
    expect(result.canCommit).toBe(true)
    expect(result.issues.some((i) => i.code === 'duplicate_reference')).toBe(false)
    // The only thing said about it is that a reference will be generated.
    expect(result.issues.some((i) => i.code === 'generated_reference')).toBe(true)
  })
})

// ─── Matching programmes, rounds and themes ─────────────────────────────────

describe('matching a value that was never offered', () => {
  // Rounds are named after years, so the round in a foundation's old export is one
  // character from the round in Custodian — and that character is a digit, which is
  // never a typo. The review screen pre-selects a suggestion, so confirming the page
  // without reading it puts a year of grants in the wrong round, moving every one of
  // them into a different financial year and a different budget meter.
  //
  // Typing a round Custodian has never heard of is a SUPPORTED answer (the import
  // creates it), which is what makes this different from the programme column: the
  // right outcome for "Spring 2024" against a list holding only "Spring 2025" is a new
  // round, not a near miss. Documented rather than failed because the remedy is a
  // product call: don't suggest across a differing digit, or don't pre-select a
  // suggestion for the one column where "none of these" is a real answer.
  it('suggests last year’s round for this year’s, on a one-digit difference', () => {
    const result = matchValue('Spring 2024', [{ id: 'r1', name: 'Spring 2025' }])
    expect(result.kind).toBe('suggestion')
    if (result.kind === 'suggestion') expect(result.score).toBeGreaterThan(0.9)
  })

  // Right, and the reason the threshold is where it is: a round that shares a prefix
  // with two others is not confidently anything.
  it('gives up rather than choosing between two rounds it is equally close to', () => {
    expect(
      matchValue('2025', [
        { id: 'r1', name: 'Spring 2025' },
        { id: 'r2', name: 'Autumn 2025' },
      ]).kind,
    ).toBe('none')
  })
})

describe('a themes cell separated the way people actually separate things', () => {
  const PROGRAMMES: ProgrammeWithThemes[] = [
    { id: 'p1', name: 'Young People', tags: ['Youth', 'Mental health', 'Employment'] },
  ]

  // The template asks for semicolons and says why (a theme name can contain a comma).
  // A comma-separated cell therefore arrives as ONE value, which matches nothing and
  // lands on the review screen as a distinct value to map. Everything so far is right.
  //
  // What follows is not: the only choices the screen offers for that value are one
  // theme or none, so mapping "Youth, Mental health" to Youth silently drops Mental
  // health, and the grant is tagged with half of what the foundation said. `grantThemes`
  // reports a theme belonging to another programme and a theme with no decision, both
  // of which the commit refuses — it has nothing to report here, because from its point
  // of view one value became one theme. Splitting a matched-nothing value on commas
  // before offering it, or saying plainly that a value can only become one theme, is
  // what would close it.
  it('loses the second theme when the cell was separated with a comma', () => {
    expect(splitThemes('Youth, Mental health')).toEqual(['Youth, Mental health'])

    const [resolution] = resolveColumn(['Youth, Mental health'], [
      { id: 'Youth', name: 'Youth' },
      { id: 'Mental health', name: 'Mental health' },
    ])
    expect(resolution!.match.kind).toBe('none')

    const result = grantThemes({ themes: ['Youth, Mental health'] }, PROGRAMMES[0]!.tags, {
      'Youth, Mental health': 'Youth',
    })
    expect(result).toEqual({ themes: ['Youth'], outside: [], undecided: [] })
  })

  // Pinned: a cell of separators and nothing else is a blank cell, which means every
  // theme the programme has rather than none.
  it('reads a cell of nothing but separators as blank', () => {
    expect(splitThemes(' ; ; ')).toEqual([])
    expect(grantThemes({ themes: [] }, PROGRAMMES[0]!.tags, {}).themes).toEqual(
      PROGRAMMES[0]!.tags,
    )
  })
})
