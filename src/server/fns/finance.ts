import { notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, awards } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { recordAudit } from '../audit'
import { assertClientAccess, visibleRoundProgrammeIds } from '../scope'
import { checkBankAccount, type ModulusCheckStatus } from '../../lib/bankVerification'
import { DUE_SOON_DAYS, addDaysIso, todayIso } from '../../lib/schedule'
import { paginate, PAGE_SIZE } from '../../lib/pagination'
import { sortRows } from '../../lib/sortRows'
import { facetBy, facetByMany, type FacetOption } from '../../lib/facets'

// Finance reads the same grants as Awards, but through the payments lens: one row per
// grant, keyed on where its money is up to rather than on the decision that made it.
// The payment actions (`setInstalmentPaid`, `updateInstalment`) live in
// `fns/applications.ts` and are reused as-is; the one write that is the payments lens's
// own is `updateGrantBankDetails` at the foot of this file.

/**
 * Where a grant's money is up to. Ordered by urgency: `overdue` first through to
 * settled. `unscheduled` is a committed grant with no instalments recorded at all —
 * money promised with no payment plan, which is a finance problem of its own.
 */
export type FinanceStatus =
  | 'overdue'
  | 'due_soon'
  | 'scheduled'
  | 'unscheduled'
  | 'paid'
  | 'cancelled'

/** `missing` = we hold no details to check; the rest come from the modulus checker. */
export type BankStatus = ModulusCheckStatus | 'missing'

type InstalmentRow = {
  id: string
  instalmentNo: number
  amount: string
  dueDate: string | null
  paidDate: string | null
}

type BankFields = {
  bankName: string | null
  bankAccountName: string | null
  bankAccountNumber: string | null
  bankSortCode: string | null
}

/**
 * Level-1 bank check for a grant: is the sort code + account number we hold a
 * mathematically valid pair? Free and offline (see `lib/bankVerification`). It
 * proves nothing about who owns the account — that is Confirmation of Payee, a
 * later, paid check.
 */
function bankCheck(app: BankFields): { status: BankStatus; reason?: string } {
  if (!app.bankSortCode || !app.bankAccountNumber) return { status: 'missing' }
  const result = checkBankAccount({
    sortCode: app.bankSortCode,
    accountNumber: app.bankAccountNumber,
  })
  return { status: result.status, reason: result.reason }
}

/** Last four digits of an account number, for display without exposing the whole thing. */
function last4(accountNumber: string | null): string | null {
  if (!accountNumber) return null
  const digits = accountNumber.replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

/**
 * Reduce a grant's instalments to the finance view: what is paid, what is next, and
 * how urgent that next payment is.
 */
function summarisePayments(instalments: InstalmentRow[], cancelled: boolean) {
  const now = todayIso()
  const soonCutoff = addDaysIso(now, DUE_SOON_DAYS)

  const paid = instalments.filter((i) => i.paidDate)
  const unpaid = instalments.filter((i) => !i.paidDate)
  const paidToDate = paid.reduce((s, i) => s + parseFloat(i.amount), 0)
  const scheduledTotal = instalments.reduce((s, i) => s + parseFloat(i.amount), 0)

  // Next payment = the earliest-dated unpaid instalment. Dateless ("TBC") instalments
  // sort last: they are outstanding money, but they cannot be chased on a date.
  const nextUp = [...unpaid].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return a.instalmentNo - b.instalmentNo
  })[0]

  const overdue = unpaid.filter((i) => i.dueDate && i.dueDate < now)
  const dueSoon = unpaid.filter((i) => i.dueDate && i.dueDate >= now && i.dueDate <= soonCutoff)

  let status: FinanceStatus
  if (cancelled) status = 'cancelled'
  else if (instalments.length === 0) status = 'unscheduled'
  else if (unpaid.length === 0) status = 'paid'
  else if (overdue.length > 0) status = 'overdue'
  else if (dueSoon.length > 0) status = 'due_soon'
  else status = 'scheduled'

  const lastPaidDate = paid.reduce<string | null>(
    (latest, i) =>
      latest === null || (i.paidDate as string) > latest ? (i.paidDate as string) : latest,
    null,
  )

  return {
    status,
    paidToDate,
    scheduledTotal,
    paidCount: paid.length,
    instalmentCount: instalments.length,
    lastPaidDate,
    nextPayment: nextUp
      ? { id: nextUp.id, amount: parseFloat(nextUp.amount), dueDate: nextUp.dueDate }
      : null,
    overdueAmount: overdue.reduce((s, i) => s + parseFloat(i.amount), 0),
    overdueCount: overdue.length,
    dueSoonAmount: dueSoon.reduce((s, i) => s + parseFloat(i.amount), 0),
    dueSoonCount: dueSoon.length,
  }
}

// ─── Upcoming payments ───────────────────────────────────────────────────────

/** One unpaid instalment, named by the grant it belongs to. */
export type UpcomingPayment = {
  awardId: string
  organisationName: string
  programmeName: string | null
  dueDate: string
  amount: number
}

/** A horizon's worth of them: the whole bucket's money, and the first few by date. */
export type UpcomingBucket = { total: number; count: number; items: UpcomingPayment[] }

/** How many payments each bucket names before it just says how many more there are. */
const UPCOMING_SHOWN = 4

/** `2026-08-11` → `2026-08-31`. Day 0 of the next month is the last of this one. */
function endOfMonthIso(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10)
}

/** Same day-of-month, `n` months on; overflow rolls forward, which is fine for a horizon. */
function addMonthsIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1 + n, d!)).toISOString().slice(0, 10)
}

function bucket(payments: UpcomingPayment[]): UpcomingBucket {
  const sorted = [...payments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))
  return {
    total: sorted.reduce((s, p) => s + p.amount, 0),
    count: sorted.length,
    items: sorted.slice(0, UPCOMING_SHOWN),
  }
}

function emptyUpcoming() {
  const none: UpcomingBucket = { total: 0, count: 0, items: [] }
  return { overdue: none, thisMonth: none, next3Months: none }
}

/**
 * Every grant with money attached, for the Finance list. One row per grant, with its
 * committed / paid / next-payment position and a bank-detail flag.
 *
 * Cancelled awards are included only when money has already left (so the paid history
 * still reconciles) and never contribute to the overdue / due / outstanding totals —
 * there is nothing left to pay on them.
 */
export const listFinanceGrants = createServerFn({ method: 'GET' })
  .validator(
    z
      .object({
        /** Which tab is open. "To pay" is anything still owing; "paid" is settled + cancelled. */
        tab: z.enum(['to_pay', 'paid']).optional(),
        roundId: z.uuid().optional(),
        programmeId: z.uuid().optional(),
        /** A programme theme (`programmes.tags`), as the Theme pill offers them. */
        tag: z.string().min(1).max(100).optional(),
        status: z
          .enum(['overdue', 'due_soon', 'scheduled', 'unscheduled', 'paid', 'cancelled'])
          .optional(),
        /** Inclusive `yyyy-mm-dd` window against the tab's payment date — see `paymentDate`. */
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        /**
         * Column sort, applied over the whole filtered tab — see `sortRows`. `next` and
         * `lastPaid` each only exist on one tab's columns; sorting by the other tab's
         * date is harmless (every row's value is blank, so the order is unchanged).
         */
        sortBy: z
          .enum([
            'organisation',
            'programme',
            'committed',
            'paid',
            'next',
            'lastPaid',
            'bank',
            'status',
          ])
          .optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
        page: z.number().int().positive().optional(),
        /** Raised by the CSV export, which is the whole filtered set by definition. */
        pageSize: z.number().int().positive().max(10_000).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const roundProgrammeIds = await visibleRoundProgrammeIds(user)
    if (roundProgrammeIds !== null && roundProgrammeIds.length === 0) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
        tabCounts: { to_pay: 0, paid: 0 },
        totals: emptyTotals(),
        upcoming: emptyUpcoming(),
        facets: emptyFacets(),
      }
    }

    // Named columns — same reason as `listAwards`. The bank fields are needed for the
    // modulus check; none of the jsonb is.
    const apps = await getDb().query.applications.findMany({
      where: and(
        eq(applications.status, 'awarded'),
        roundProgrammeIds ? inArray(applications.roundProgrammeId, roundProgrammeIds) : undefined,
      ),
      columns: {
        id: true,
        organisationName: true,
        bankName: true,
        bankAccountName: true,
        bankSortCode: true,
        bankAccountNumber: true,
      },
      with: {
        roundProgramme: { with: { programme: true, round: true } },
        award: { with: { instalments: true } },
      },
    })

    const items = apps
      .filter((a) => a.award)
      .map((a) => {
        const award = a.award!
        const cancelled = award.status === 'cancelled'
        const pay = summarisePayments(award.instalments, cancelled)
        const committed = parseFloat(award.amountAwarded)
        const bank = bankCheck(a)
        return {
          awardId: award.id,
          applicationId: a.id,
          organisationName: a.organisationName,
          programmeId: a.roundProgramme?.programmeId ?? null,
          programmeName: a.roundProgramme?.programme?.name ?? null,
          roundId: a.roundProgramme?.roundId ?? null,
          roundName: a.roundProgramme?.round?.name ?? null,
          // The theme filter's vocabulary: a programme's tags, as Awards uses them.
          tags: (a.roundProgramme?.programme?.tags as string[] | null) ?? [],
          awardStatus: award.status,
          decisionAt: award.decisionAt.toISOString(),
          committed,
          // Outstanding is measured against what was COMMITTED, not against the
          // instalment plan — an unscheduled or short-scheduled grant still owes the
          // full difference, and hiding that is exactly the gap finance cares about.
          outstanding: cancelled ? 0 : committed - pay.paidToDate,
          bank: { status: bank.status, last4: last4(a.bankAccountNumber) },
          ...pay,
        }
      })
      // Payment order: the money you owe soonest, first. Dateless and unscheduled grants
      // land at the end of the "to pay" list, and settled grants sort by most recently
      // paid — the two tabs each read top-down as "what matters now".
      .sort((x, y) => {
        // A cancelled grant has no payment to chase, whatever its schedule still says.
        const xd = x.awardStatus === 'cancelled' ? null : (x.nextPayment?.dueDate ?? null)
        const yd = y.awardStatus === 'cancelled' ? null : (y.nextPayment?.dueDate ?? null)
        if (xd && yd) return xd.localeCompare(yd)
        if (xd) return -1
        if (yd) return 1
        return (y.lastPaidDate ?? '').localeCompare(x.lastPaidDate ?? '')
      })

    const payable = items.filter((i) => i.awardStatus !== 'cancelled')
    const totals = {
      grantCount: payable.length,
      committed: payable.reduce((s, i) => s + i.committed, 0),
      // Paid-to-date includes cancelled grants: that money genuinely went out.
      paidToDate: items.reduce((s, i) => s + i.paidToDate, 0),
      paidCount: items.reduce((s, i) => s + i.paidCount, 0),
      outstanding: payable.reduce((s, i) => s + i.outstanding, 0),
      overdueAmount: payable.reduce((s, i) => s + i.overdueAmount, 0),
      overdueCount: payable.reduce((s, i) => s + i.overdueCount, 0),
      overdueGrants: payable.filter((i) => i.overdueCount > 0).length,
      dueSoonAmount: payable.reduce((s, i) => s + i.dueSoonAmount, 0),
      dueSoonCount: payable.reduce((s, i) => s + i.dueSoonCount, 0),
      unscheduledCount: payable.filter((i) => i.status === 'unscheduled').length,
      // Grants still owing money whose bank details are missing or fail the modulus
      // check — every one of them is a payment that cannot go out cleanly.
      bankIssueCount: payable.filter(
        (i) => i.status !== 'paid' && (i.bank.status === 'missing' || i.bank.status === 'invalid'),
      ).length,
    }

    // Upcoming payments: every unpaid dated instalment in scope, bucketed by horizon.
    // Deliberately NOT narrowed by the filters below — this is the screen's "what is
    // coming at you" strip, and a panel that emptied itself when you filtered the table
    // would hide exactly the payment you had filtered away from.
    const today = todayIso()
    const monthEnd = endOfMonthIso(today)
    // Three ROLLING months rather than the rest of the calendar quarter: in the last
    // month of a quarter that bucket is structurally empty, so a third of the year the
    // panel would carry a dead card.
    const horizon = addMonthsIso(today, 3)
    const duePayments: UpcomingPayment[] = []
    for (const a of apps) {
      const award = a.award
      if (!award || award.status === 'cancelled') continue
      for (const i of award.instalments) {
        if (i.paidDate || !i.dueDate) continue
        duePayments.push({
          awardId: award.id,
          organisationName: a.organisationName,
          programmeName: a.roundProgramme?.programme?.name ?? null,
          dueDate: i.dueDate,
          amount: parseFloat(i.amount),
        })
      }
    }
    const upcoming = {
      overdue: bucket(duePayments.filter((p) => p.dueDate < today)),
      thisMonth: bucket(duePayments.filter((p) => p.dueDate >= today && p.dueDate <= monthEnd)),
      next3Months: bucket(duePayments.filter((p) => p.dueDate > monthEnd && p.dueDate <= horizon)),
    }

    // Each grant sits under exactly one tab. The tab is this screen's *context* filter,
    // so the pills below are faceted over it — you can only filter by a round or theme
    // some grant on this tab actually has.
    const toPay = items.filter((g) => g.status !== 'paid' && g.status !== 'cancelled')
    const settled = items.filter((g) => g.status === 'paid' || g.status === 'cancelled')
    const tabRows = data?.tab === 'paid' ? settled : toPay

    const facets = {
      statuses: facetBy(tabRows, (g) => ({
        value: g.status,
        label: FINANCE_STATUS_LABELS[g.status],
      })),
      programmes: facetBy(tabRows, (g) =>
        g.programmeId
          ? { value: g.programmeId, label: g.programmeName ?? 'Untitled programme' }
          : null,
      ),
      themes: facetByMany(tabRows, (g) => g.tags.map((t) => ({ value: t, label: t }))),
      rounds: facetBy(tabRows, (g) =>
        g.roundId ? { value: g.roundId, label: g.roundName ?? 'Untitled round' } : null,
      ),
    }

    // The date window runs against the payment date the open tab is ABOUT: when you are
    // paying, that is the next payment due; when you are reconciling what went out, it is
    // the last payment made. One control, the meaning of which follows the tab.
    const inWindow = (day: string | null) => {
      if (!data?.from && !data?.to) return true
      if (!day) return false
      return (!data?.from || day >= data.from) && (!data?.to || day <= data.to)
    }
    const matches = (g: (typeof items)[number], day: string | null) =>
      (!data?.roundId || g.roundId === data.roundId) &&
      (!data?.programmeId || g.programmeId === data.programmeId) &&
      (!data?.tag || g.tags.includes(data.tag)) &&
      (!data?.status || g.status === data.status) &&
      inWindow(day)

    // Both tabs are counted through the same filters, so a tab label never promises rows
    // the filters would remove the moment you switched to it.
    const matchedToPay = toPay.filter((g) => matches(g, g.nextPayment?.dueDate ?? null))
    const matchedPaid = settled.filter((g) => matches(g, g.lastPaidDate))
    const tabCounts = { to_pay: matchedToPay.length, paid: matchedPaid.length }
    const rows = data?.tab === 'paid' ? matchedPaid : matchedToPay

    // Sorted before paging, so page 2 is the second page of the sort. With no `sortBy`
    // the payment order above stands: the money you owe soonest, first.
    const sorted = sortRows(
      rows,
      { by: data?.sortBy, dir: data?.sortDir },
      {
        organisation: (g) => g.organisationName,
        programme: (g) => g.programmeName,
        committed: (g) => g.committed,
        paid: (g) => g.paidToDate,
        // A cancelled grant has nothing to chase, so it sorts as dateless here for the
        // same reason it does in the default order — not as a payment due long ago.
        next: (g) => (g.awardStatus === 'cancelled' ? null : (g.nextPayment?.dueDate ?? null)),
        lastPaid: (g) => g.lastPaidDate,
        bank: (g) => BANK_SORT_ORDER[g.bank.status] ?? 9,
        status: (g) => FINANCE_STATUS_ORDER[g.status] ?? 9,
      },
    )

    return { ...paginate(sorted, data?.page, data?.pageSize), tabCounts, totals, upcoming, facets }
  })

/**
 * Rank behind the two pills this table sorts on. Both run most-urgent-first, so the
 * default (descending) click puts the rows that need doing something at the top —
 * alphabetical order over either vocabulary would say nothing.
 */
const FINANCE_STATUS_ORDER: Record<string, number> = {
  overdue: 0,
  due_soon: 1,
  unscheduled: 2,
  scheduled: 3,
  paid: 4,
  cancelled: 5,
}

/** Bank details that would stop a payment going out, first. */
const BANK_SORT_ORDER: Record<string, number> = { missing: 0, invalid: 1, unchecked: 2, valid: 3 }

/** One vocabulary for a grant's payment position, shared by the facets and the table. */
export const FINANCE_STATUS_LABELS: Record<FinanceStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  scheduled: 'Scheduled',
  unscheduled: 'No schedule',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

function emptyFacets(): {
  statuses: FacetOption[]
  programmes: FacetOption[]
  themes: FacetOption[]
  rounds: FacetOption[]
} {
  return { statuses: [], programmes: [], themes: [], rounds: [] }
}

function emptyTotals() {
  return {
    grantCount: 0,
    committed: 0,
    paidToDate: 0,
    paidCount: 0,
    outstanding: 0,
    overdueAmount: 0,
    overdueCount: 0,
    overdueGrants: 0,
    dueSoonAmount: 0,
    dueSoonCount: 0,
    unscheduledCount: 0,
    bankIssueCount: 0,
  }
}

/**
 * One grant's money, end to end: where it has got to in its lifecycle, the payment
 * schedule (paid and still to come), and the bank details we would pay it into with
 * the modulus verdict.
 *
 * Deliberately NO reporting detail. Reporting belongs to the award record — a
 * finance officer here is answering "can I pay this, and what's left", not "what has
 * this grantee told us".
 */
export const getFinanceGrant = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, data.id),
      with: {
        application: { with: { roundProgramme: { with: { programme: true, round: true } } } },
        instalments: true,
        // The award letter is a lifecycle step, not a document, here: the payment panel
        // says whether the grantee has been told, and never renders the letter itself.
        letter: { columns: { status: true, sentAt: true, failureReason: true } },
      },
    })
    if (!award) throw notFoundError()
    assertClientAccess(user, award.clientId)

    const app = award.application
    const rp = app.roundProgramme
    const cancelled = award.status === 'cancelled'
    const committed = parseFloat(award.amountAwarded)
    const pay = summarisePayments(award.instalments, cancelled)
    const now = todayIso()
    const soonCutoff = addDaysIso(now, DUE_SOON_DAYS)

    const instalments = [...award.instalments]
      .sort((a, b) => a.instalmentNo - b.instalmentNo)
      .map((i) => ({
        id: i.id,
        instalmentNo: i.instalmentNo,
        amount: parseFloat(i.amount),
        dueDate: i.dueDate,
        paidDate: i.paidDate,
        status: (i.paidDate
          ? 'paid'
          : !i.dueDate
            ? 'tbc'
            : i.dueDate < now
              ? 'overdue'
              : i.dueDate <= soonCutoff
                ? 'due_soon'
                : 'upcoming') as 'paid' | 'tbc' | 'overdue' | 'due_soon' | 'upcoming',
      }))

    const bank = bankCheck(app)
    // The Finance screen is payments-only, so `finance` gets the full edit set here.
    const canEdit = user.role === 'superadmin' || user.role === 'admin' || user.role === 'finance'

    return {
      id: award.id,
      applicationId: app.id,
      organisationName: app.organisationName,
      programmeName: rp?.programme?.name ?? null,
      roundName: rp?.round?.name ?? null,
      awardStatus: award.status,
      decisionAt: award.decisionAt.toISOString(),
      durationYears: rp?.grantDurationYears ?? null,
      committed,
      outstanding: cancelled ? 0 : committed - pay.paidToDate,
      status: pay.status,
      paidToDate: pay.paidToDate,
      paidCount: pay.paidCount,
      instalmentCount: pay.instalmentCount,
      scheduledTotal: pay.scheduledTotal,
      nextPayment: pay.nextPayment,
      lastPaidDate: pay.lastPaidDate,
      // The plan may not add up to the promise — say so rather than let it hide.
      unallocated: cancelled ? 0 : committed - pay.scheduledTotal,
      instalments,
      letter: award.letter
        ? {
            status: award.letter.status,
            sentAt: award.letter.sentAt?.toISOString() ?? null,
            failureReason: award.letter.failureReason,
          }
        : null,
      bank: {
        status: bank.status,
        reason: bank.reason ?? null,
        bankName: app.bankName,
        accountName: app.bankAccountName,
        sortCode: app.bankSortCode,
        accountNumber: app.bankAccountNumber,
        last4: last4(app.bankAccountNumber),
      },
      externalApplicationId: app.externalApplicationId,
      charityNumber: app.charityNumber,
      companyNumber: app.companyNumber,
      canEdit,
    }
  })

// ─── Correcting where the money goes ─────────────────────────────────────────

/** Empty (or all-whitespace) reads as "we hold nothing", not as an empty string. */
const BankText = z
  .string()
  .trim()
  .max(100)
  .transform((v) => v || null)
  .nullable()
  .optional()

/**
 * Correct the bank details a grant would be paid into.
 *
 * These columns live on the APPLICATION — they are what the grantee submitted — so this
 * overwrites their own words, and it is the one edit in the app that changes where money
 * lands. Hence the audit row: not because a typo needs ceremony, but because "who
 * redirected this payment, and when" is a question a foundation will one day have to
 * answer, and the column alone only ever holds the latest answer.
 *
 * Values are stored as typed. `checkBankAccount` strips spaces and dashes itself, so
 * "08-99-99" and "089999" are the same pair to the modulus check, and the badge on the
 * panel re-derives from the stored values on the next read — there is no status column
 * here to fall out of step.
 *
 * Clearing both numbers is allowed, unlike clearing a registration number: an unpayable
 * grant is an ordinary state (it is the state every grant starts in), and the panel says
 * so plainly rather than pretending otherwise.
 */
export const updateGrantBankDetails = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      awardId: z.uuid(),
      accountName: BankText,
      bankName: BankText,
      sortCode: BankText,
      accountNumber: BankText,
    }),
  )
  .handler(async ({ data }) => {
    // Same set as the panel's `canEdit`: paying grants is exactly what `finance` is for.
    const user = await requireRole('superadmin', 'admin', 'finance')
    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, data.awardId),
      columns: { id: true, clientId: true, applicationId: true },
    })
    if (!award) throw notFoundError()
    assertClientAccess(user, award.clientId)

    const before = await getDb().query.applications.findFirst({
      where: eq(applications.id, award.applicationId),
      columns: { bankSortCode: true, bankAccountNumber: true },
    })
    if (!before) throw notFoundError()

    await getDb()
      .update(applications)
      .set({
        ...(data.accountName !== undefined ? { bankAccountName: data.accountName } : {}),
        ...(data.bankName !== undefined ? { bankName: data.bankName } : {}),
        ...(data.sortCode !== undefined ? { bankSortCode: data.sortCode } : {}),
        ...(data.accountNumber !== undefined ? { bankAccountNumber: data.accountNumber } : {}),
      })
      .where(eq(applications.id, award.applicationId))

    // Only when the destination actually moved. Renaming the account holder or filling in
    // the bank's name is housekeeping; the sort code and account number are the payment.
    const moved =
      (data.sortCode !== undefined && data.sortCode !== before.bankSortCode) ||
      (data.accountNumber !== undefined && data.accountNumber !== before.bankAccountNumber)
    if (moved) {
      await recordAudit({
        actorUserId: user.id,
        action: 'grant_bank_details_changed',
        applicationId: award.applicationId,
        clientId: award.clientId,
        // Last four only. The feed is a screen several people can read, and a full
        // account number does not need to be on it to answer "did this change".
        metadata: {
          from: { sortCode: before.bankSortCode, last4: last4(before.bankAccountNumber) },
          to: {
            sortCode: data.sortCode !== undefined ? data.sortCode : before.bankSortCode,
            last4: last4(
              data.accountNumber !== undefined ? data.accountNumber : before.bankAccountNumber,
            ),
          },
        },
      })
    }
  })
