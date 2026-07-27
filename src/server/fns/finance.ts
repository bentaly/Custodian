import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, awards } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { assertClientAccess, visibleRoundProgrammeIds } from '../scope'
import { checkBankAccount, type ModulusCheckStatus } from '../../lib/bankVerification'
import { DUE_SOON_DAYS, addDaysIso, todayIso } from '../../lib/schedule'

// Finance reads the same grants as Awards, but through the payments lens: one row per
// grant, keyed on where its money is up to rather than on the decision that made it.
// Nothing here writes — the payment actions (`setInstalmentPaid`, `updateInstalment`)
// already live in `fns/applications.ts` and are reused as-is.

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

type InstalmentRow = { id: string; instalmentNo: number; amount: string; dueDate: string | null; paidDate: string | null }

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
    (latest, i) => (latest === null || (i.paidDate as string) > latest ? (i.paidDate as string) : latest),
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

/**
 * Every grant with money attached, for the Finance list. One row per grant, with its
 * committed / paid / next-payment position and a bank-detail flag.
 *
 * Cancelled awards are included only when money has already left (so the paid history
 * still reconciles) and never contribute to the overdue / due / outstanding totals —
 * there is nothing left to pay on them.
 */
export const listFinanceGrants = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  const roundProgrammeIds = await visibleRoundProgrammeIds(user)
  if (roundProgrammeIds !== null && roundProgrammeIds.length === 0) {
    return { items: [], totals: emptyTotals() }
  }

  const apps = await getDb().query.applications.findMany({
    where: and(
      eq(applications.status, 'awarded'),
      roundProgrammeIds ? inArray(applications.roundProgrammeId, roundProgrammeIds) : undefined,
    ),
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
        programmeName: a.roundProgramme?.programme?.name ?? null,
        roundName: a.roundProgramme?.round?.name ?? null,
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

  return { items, totals }
})

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
 * One grant's money, end to end: the payment schedule (paid and still to come), the
 * bank details we would pay it into with the modulus verdict, and how the grant sits
 * inside its round-programme budget.
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
      },
    })
    if (!award) throw new Error('Not found')
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

    // Where this grant sits in its round-programme's pot: the same budget the round
    // screen tracks, but answered from the awards actually made.
    let budget: { budget: number; committed: number; paidToDate: number; grantCount: number } | null = null
    if (rp) {
      const siblings = await getDb().query.applications.findMany({
        where: and(eq(applications.status, 'awarded'), eq(applications.roundProgrammeId, rp.id)),
        columns: { id: true },
        with: { award: { with: { instalments: true } } },
      })
      const live = siblings.filter((s) => s.award && s.award.status !== 'cancelled')
      budget = {
        budget: rp.budget ? parseFloat(rp.budget) : 0,
        committed: live.reduce((s, x) => s + parseFloat(x.award!.amountAwarded), 0),
        paidToDate: live.reduce(
          (s, x) =>
            s + x.award!.instalments.filter((i) => i.paidDate).reduce((t, i) => t + parseFloat(i.amount), 0),
          0,
        ),
        grantCount: live.length,
      }
    }

    const bank = bankCheck(app)
    // The Finance screen is payments-only, so `finance` gets the full edit set here.
    const canEdit =
      user.role === 'superadmin' || user.role === 'admin' || user.role === 'finance'

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
      budget,
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
