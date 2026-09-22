/**
 * Grant creditors at a year end: what a foundation had promised and not yet paid.
 *
 * ## Why it exists (Notion: "Proposal: year-end grant creditors report")
 *
 * Under the Charities SORP a grant is a liability the day it is committed, however long
 * the payments are spread, and the accounts must show the unpaid part split in two:
 * **due within one year** and **due after more than one year**. Custodian holds every
 * grant and every instalment date, so the list an accountant used to build by hand from
 * spreadsheets is one download on Finance → Balance & budget.
 *
 * ## The rules, each of which is the easy one to get wrong
 *
 * - **"As at" is a date in the past, and the schedule has moved since.** An instalment
 *   PAID after the year end was UNPAID on it. So paid-by-year-end reads `paidDate`, never
 *   the bare fact that `paidDate` is set: run in May for a March year end, the April
 *   payment run must still be owed.
 * - **A grant decided after the year end was not a creditor on it** and is left out.
 * - **Unpaid is measured against the award, not the instalment plan** — the same rule as
 *   Finance's `outstanding`. A grant scheduled short of its award still owes the gap, and
 *   that gap (with any instalment still "date TBC") has no date to be bucketed by, so it
 *   gets its own column rather than a guess. An accountant decides where it goes; a
 *   silent bucket would put it in the accounts without anybody having decided.
 * - **Arrears are due within one year.** An instalment due before the year end and still
 *   unpaid on it is owed now, which is inside twelve months by any reading.
 * - **The boundary is the NEXT year end**, inclusive: a £20,000 instalment due on the
 *   anniversary of a 31 March year end is due within one year.
 * - **Cancelled grants are excluded** — the money rule's "outstanding EXCLUDES cancelled".
 *   The query does that; nothing here sees one.
 *
 * Money is summed in pence so a column of instalments cannot drift a penny off its total.
 */

export type CreditorInstalment = {
  amount: number
  dueDate: string | null
  paidDate: string | null
}

export type CreditorGrant = {
  awardId: string
  organisationName: string
  /** The foundation's own grant reference. */
  reference: string | null
  programmeName: string | null
  roundName: string | null
  /** `yyyy-mm-dd`, the day the grant was decided. */
  decisionDate: string
  amountAwarded: number
  instalments: CreditorInstalment[]
}

export type CreditorLine = {
  awardId: string
  organisationName: string
  reference: string | null
  programmeName: string | null
  roundName: string | null
  decisionDate: string
  amountAwarded: number
  paidByYearEnd: number
  dueWithinOneYear: number
  dueAfterOneYear: number
  /** Undated instalments plus any part of the award no instalment covers. */
  noDueDate: number
  totalUnpaid: number
}

export type CreditorTotals = Omit<
  CreditorLine,
  'awardId' | 'organisationName' | 'reference' | 'programmeName' | 'roundName' | 'decisionDate'
> & { count: number }

export type CreditorsReport = {
  yearEnd: string
  /** The last day counted as "within one year". */
  oneYearOn: string
  lines: CreditorLine[]
  totals: CreditorTotals
}

const pence = (n: number) => Math.round(n * 100)
const pounds = (p: number) => p / 100

/** The same calendar day a year on, pulled back to the month's end where it does not exist. */
export function oneYearAfter(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate()
  // A year end on the last day of its month stays on the last day: 28 Feb 2026 → 28 Feb
  // 2027, but 29 Feb 2028 → 28 Feb 2029 rather than 1 March.
  const day = Math.min(d, last)
  return `${y + 1}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function grantCreditorLine(grant: CreditorGrant, yearEnd: string): CreditorLine | null {
  if (grant.decisionDate > yearEnd) return null
  const oneYearOn = oneYearAfter(yearEnd)

  let paid = 0
  let within = 0
  let after = 0
  let undated = 0
  for (const i of grant.instalments) {
    const p = pence(i.amount)
    if (i.paidDate !== null && i.paidDate <= yearEnd) paid += p
    else if (i.dueDate === null) undated += p
    else if (i.dueDate <= oneYearOn) within += p
    else after += p
  }

  // What no instalment covers. Floored at zero: a schedule that sums to MORE than the
  // award is a data problem the award screen already refuses to create, and a negative
  // "no due date" would quietly net it off against real creditors.
  const unscheduled = Math.max(0, pence(grant.amountAwarded) - paid - within - after - undated)
  const noDueDate = undated + unscheduled
  const total = within + after + noDueDate
  if (total <= 0) return null

  return {
    awardId: grant.awardId,
    organisationName: grant.organisationName,
    reference: grant.reference,
    programmeName: grant.programmeName,
    roundName: grant.roundName,
    decisionDate: grant.decisionDate,
    amountAwarded: grant.amountAwarded,
    paidByYearEnd: pounds(paid),
    dueWithinOneYear: pounds(within),
    dueAfterOneYear: pounds(after),
    noDueDate: pounds(noDueDate),
    totalUnpaid: pounds(total),
  }
}

export function grantCreditors(grants: CreditorGrant[], yearEnd: string): CreditorsReport {
  const lines = grants
    .map((g) => grantCreditorLine(g, yearEnd))
    .filter((l): l is CreditorLine => l !== null)
    .sort(
      (a, b) =>
        a.organisationName.localeCompare(b.organisationName, 'en-GB') ||
        a.decisionDate.localeCompare(b.decisionDate),
    )

  const sum = (pick: (l: CreditorLine) => number) =>
    pounds(lines.reduce((acc, l) => acc + pence(pick(l)), 0))

  return {
    yearEnd,
    oneYearOn: oneYearAfter(yearEnd),
    lines,
    totals: {
      count: lines.length,
      amountAwarded: sum((l) => l.amountAwarded),
      paidByYearEnd: sum((l) => l.paidByYearEnd),
      dueWithinOneYear: sum((l) => l.dueWithinOneYear),
      dueAfterOneYear: sum((l) => l.dueAfterOneYear),
      noDueDate: sum((l) => l.noDueDate),
      totalUnpaid: sum((l) => l.totalUnpaid),
    },
  }
}
