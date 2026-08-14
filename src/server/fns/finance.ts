import { notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, awardInstalments, awards } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { recordAudit } from '../audit'
import { assertClientAccess, visibleRoundProgrammeIds } from '../scope'
import { checkBankAccount, type ModulusCheckStatus } from '../../lib/bankVerification'
import {
  DUE_SOON_DAYS,
  addDaysIso,
  addMonthsIso,
  endOfMonthIso,
  todayIso,
} from '../../lib/schedule'
import { PAGE_SIZE } from '../../lib/pagination'
import { type FacetOption } from '../../lib/facets'
import {
  financeDates,
  filterWhere,
  grantsQuery,
  tabWhere,
  grantsCol,
  type FinanceDates,
  type GrantRow,
  type GrantsQuery,
} from '../finance/query'

/**
 * The sortable columns. `bank` is deliberately absent: sorting by the modulus outcome
 * would mean evaluating it over every grant in the tenant, which is exactly the load
 * this file just shed. Bank problems are surfaced instead by the Attention banner,
 * which counts them portfolio-wide. It comes back the day the check is stored.
 */
type SortKey = 'organisation' | 'programme' | 'committed' | 'paid' | 'next' | 'lastPaid' | 'status'

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

/** The two fields the modulus check reads — nothing else about a grant matters to it. */
type BankFields = { bankSortCode: string | null; bankAccountNumber: string | null }

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

function emptyUpcoming() {
  const none: UpcomingBucket = { total: 0, count: 0, items: [] }
  return { overdue: none, thisMonth: none, next3Months: none }
}

/**
 * Every grant with money attached, for the Finance list. One row per grant, with its
 * committed / paid / next-payment position and a bank-detail flag.
 *
 * Filtered, sorted, counted and paged **in Postgres** — see `server/finance/query.ts`
 * for the two subqueries that make a grant's derived status an ordinary column, and for
 * why the whole screen is one `db.batch()`. It used to load the tenant's entire history
 * on every page turn.
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
         * Column sort, applied in SQL over the whole filtered tab — see `orderFor`.
         * `next` and `lastPaid` each only exist on one tab's columns; sorting by the
         * other tab's date is harmless (every row's value is null, and nulls sort last
         * whichever way the arrow points, so the order is unchanged).
         */
        sortBy: z
          .enum(['organisation', 'programme', 'committed', 'paid', 'next', 'lastPaid', 'status'])
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
    // An empty scope is a user with access to nothing; `inArray(x, [])` is a SQL error,
    // so it never reaches the query.
    if (roundProgrammeIds !== null && roundProgrammeIds.length === 0) return emptyFinanceList()
    return financeList(getDb(), roundProgrammeIds, data ?? {})
  })

/** Everything the list is filtered, sorted and paged by — the validator's shape. */
export type FinanceListInput = {
  tab?: 'to_pay' | 'paid'
  roundId?: string
  programmeId?: string
  tag?: string
  status?: FinanceStatus
  from?: string
  to?: string
  sortBy?: SortKey
  sortDir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

/**
 * The Finance list, as a plain function of (connection, tenant scope, filters).
 *
 * Split out from the server fn above so that everything below the auth check can be
 * exercised without a session — by a script against staging while the SQL was being
 * written, and by a test when one is wanted. The server fn is then exactly what it
 * should be: who are you, what may you see, and here is your answer.
 */
export async function financeList(
  db: ReturnType<typeof getDb>,
  scope: string[] | null,
  data: FinanceListInput,
) {
  const dates = financeDates()
  const g = grantsQuery(db, scope, dates)
  const tab = data.tab ?? 'to_pay'
  const pageSize = data.pageSize ?? PAGE_SIZE
  const page = data.page && data.page > 0 ? data.page : 1

  const filters = filterWhere(g, tab, data)
  const onTab = (t: 'to_pay' | 'paid') => and(tabWhere(g, t), filters)

  // Both tabs are counted through the filters, so a tab label never promises rows the
  // filters would remove the moment you switched to it.
  const countOn = (where: SQL | undefined) =>
    db
      .select({ n: sql<number>`(count(*))::int` })
      .from(g)
      .where(where)

  // Facets describe the TAB — this screen's context — before the transient filters,
  // so using a pill can never prune the options of the pill beside it.
  const context = tabWhere(g, tab)
  const facetOn = (value: SQLWrapper, label: SQLWrapper) =>
    db
      .select({
        value: value as SQL<string | null>,
        label: label as SQL<string | null>,
        count: sql<number>`(count(*))::int`,
      })
      .from(g)
      .where(context)
      .groupBy(value as SQL, label as SQL)

  const [
    rows,
    tabTotal,
    otherTotal,
    totalsRow,
    unscheduledRow,
    horizons,
    soonest,
    bankRows,
    statusFacet,
    programmeFacet,
    themeFacet,
    roundFacet,
  ] = await db.batch([
    db
      .select()
      .from(g)
      .where(onTab(tab))
      .orderBy(...orderFor(g, data.sortBy, data.sortDir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    countOn(onTab(tab)),
    countOn(onTab(tab === 'paid' ? 'to_pay' : 'paid')),
    // The KPI strip and the Attention banner sit ABOVE the filter row, so they are
    // portfolio-wide by the app's rule: a control only narrows what is below it.
    // `payable` excludes cancelled grants — there is nothing left to pay on them —
    // but paid-to-date counts them, because that money genuinely went out.
    db
      .select({
        grantCount: sql<number>`(count(*) filter (where ${payable(g)}))::int`,
        committed: sql<number>`coalesce(sum(${g.committed}) filter (where ${payable(g)}), 0)::float8`,
        paidToDate: sql<number>`coalesce(sum(${g.paidTotal}), 0)::float8`,
        paidCount: sql<number>`coalesce(sum(${g.paidCount}), 0)::int`,
        outstanding: sql<number>`coalesce(sum(${g.outstanding}) filter (where ${payable(g)}), 0)::float8`,
        overdueAmount: sql<number>`coalesce(sum(${g.overdueAmount}) filter (where ${payable(g)}), 0)::float8`,
        overdueCount: sql<number>`coalesce(sum(${g.overdueCount}) filter (where ${payable(g)}), 0)::int`,
        overdueGrants: sql<number>`(count(*) filter (where ${payable(g)} and ${g.overdueCount} > 0))::int`,
        dueSoonAmount: sql<number>`coalesce(sum(${g.dueSoonAmount}) filter (where ${payable(g)}), 0)::float8`,
        dueSoonCount: sql<number>`coalesce(sum(${g.dueSoonCount}) filter (where ${payable(g)}), 0)::int`,
      })
      .from(g),
    countOn(sql`${g.status} = 'unscheduled'`),
    upcomingTotals(db, g, dates),
    upcomingItems(db, g, dates),
    // The one field SQL cannot answer: `bankIssueCount` is a modulus check over every
    // payable grant's sort code and account number. Two narrow text columns rather
    // than the whole row — and the fix that deletes this is a stored check status,
    // maintained wherever bank details are written.
    db
      .select({ bankSortCode: g.bankSortCode, bankAccountNumber: g.bankAccountNumber })
      .from(g)
      .where(payable(g)),
    facetOn(g.status, g.status),
    facetOn(g.programmeId, g.programmeName),
    db
      .select({
        value: sql<string>`theme.value`,
        label: sql<string>`theme.value`,
        count: sql<number>`(count(*))::int`,
      })
      .from(g)
      .innerJoin(sql`lateral jsonb_array_elements_text(${g.tags}) as theme(value)`, sql`true`)
      .where(context)
      .groupBy(sql`theme.value`),
    facetOn(g.roundId, g.roundName),
  ])

  const items = rows.map(toFinanceRow)
  const totalsBase = totalsRow[0]!
  const bank = bankRows.map((r) => bankCheck(r).status)
  const totals = {
    ...totalsBase,
    unscheduledCount: unscheduledRow[0]?.n ?? 0,
    // Grants still owing money whose details are missing or fail the check — every one
    // of them is a payment that cannot go out cleanly.
    bankIssueCount: bank.filter((s) => s === 'missing' || s === 'invalid').length,
  }

  const total = tabTotal[0]?.n ?? 0
  const tabCounts =
    tab === 'paid'
      ? { to_pay: otherTotal[0]?.n ?? 0, paid: total }
      : { to_pay: total, paid: otherTotal[0]?.n ?? 0 }

  return {
    items,
    total,
    page,
    pageSize,
    tabCounts,
    totals,
    upcoming: toUpcoming(horizons, soonest),
    facets: {
      statuses: sortFacet(
        statusFacet.map((f) => ({
          value: f.value as FinanceStatus,
          label: FINANCE_STATUS_LABELS[f.value as FinanceStatus] ?? f.value,
          count: f.count,
        })),
      ),
      programmes: sortFacet(namedFacet(programmeFacet, 'Untitled programme')),
      themes: sortFacet(themeFacet),
      rounds: sortFacet(namedFacet(roundFacet, 'Untitled round')),
    },
  }
}

/** A caller who can see nothing still gets the shape the screen expects. */
export function emptyFinanceList() {
  return {
    items: [] as ReturnType<typeof toFinanceRow>[],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    tabCounts: { to_pay: 0, paid: 0 },
    totals: emptyTotals(),
    upcoming: emptyUpcoming(),
    facets: emptyFacets(),
  }
}

/** A grant with money still owing: cancelled ones have nothing left to pay. */
function payable(g: GrantsQuery): SQL {
  return sql`${g.awardStatus} <> 'cancelled'`
}

/** As `payable`, for the two queries that join `grants` to the instalments — see `grantsCol`. */
function payableJoined(): SQL {
  return sql`${grantsCol('award_status')} <> 'cancelled'`
}

/** A facet row whose value may be NULL (a grant with no programme) is not a facet. */
function namedFacet(
  rows: Array<{ value: string | null; label: string | null; count: number }>,
  fallback: string,
): FacetOption[] {
  return rows
    .filter((r): r is { value: string; label: string | null; count: number } => r.value !== null)
    .map((r) => ({ value: r.value, label: r.label ?? fallback, count: r.count }))
}

/** Facets read as a list, so they are alphabetical — the order `lib/facets` produced. */
function sortFacet(options: FacetOption[]): FacetOption[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The row the table renders. The money arrives as `float8` (JS numbers) rather than
 * numeric strings, because every consumer parsed them anyway.
 */
function toFinanceRow(r: GrantRow) {
  return {
    awardId: r.awardId,
    applicationId: r.applicationId,
    organisationName: r.organisationName,
    programmeId: r.programmeId,
    programmeName: r.programmeName,
    roundId: r.roundId,
    roundName: r.roundName,
    tags: (r.tags as string[] | null) ?? [],
    awardStatus: r.awardStatus,
    committed: r.committed,
    outstanding: r.outstanding,
    status: r.status as FinanceStatus,
    paidToDate: r.paidTotal,
    paidCount: r.paidCount,
    instalmentCount: r.instalmentCount,
    scheduledTotal: r.scheduledTotal,
    lastPaidDate: r.lastPaidDate,
    nextPayment:
      r.nextId && r.nextAmount !== null
        ? { id: r.nextId, amount: r.nextAmount, dueDate: r.nextDueDate }
        : null,
    overdueAmount: r.overdueAmount,
    overdueCount: r.overdueCount,
    dueSoonAmount: r.dueSoonAmount,
    dueSoonCount: r.dueSoonCount,
    bank: { status: bankCheck(r).status, last4: last4(r.bankAccountNumber) },
  }
}

/**
 * Column sort, in SQL. Text sorts case-insensitively and NULLs go last whichever way
 * the arrow points — a row with no programme is not "before A" or "after Z", it is
 * simply unranked. With no explicit sort the payment order stands: the money you owe
 * soonest, first, then settled grants by most recently paid.
 */
function orderFor(g: GrantsQuery, by: SortKey | undefined, dir: 'asc' | 'desc' | undefined): SQL[] {
  const d = sql.raw(dir === 'asc' ? 'asc' : 'desc')
  const text = (col: SQLWrapper) => sql`lower(${col}) ${d} nulls last`
  switch (by) {
    case 'organisation':
      return [text(g.organisationName)]
    case 'programme':
      return [text(g.programmeName)]
    case 'committed':
      return [sql`${g.committed} ${d}`]
    case 'paid':
      return [sql`${g.paidTotal} ${d}`]
    case 'next':
      return [sql`${g.chaseDate} ${d} nulls last`]
    case 'lastPaid':
      return [sql`${g.lastPaidDate} ${d} nulls last`]
    case 'status':
      return [sql`${statusRank(g)} ${d}`]
    default:
      return [sql`${g.chaseDate} asc nulls last`, sql`${g.lastPaidDate} desc nulls last`]
  }
}

/**
 * Most urgent first, so the default (descending) click puts the rows that need doing
 * something at the top — alphabetical order over this vocabulary would say nothing.
 */
function statusRank(g: GrantsQuery): SQL {
  return sql`case ${g.status}
    when 'overdue' then 0 when 'due_soon' then 1 when 'unscheduled' then 2
    when 'scheduled' then 3 when 'paid' then 4 else 5 end`
}

// ─── Upcoming payments ───────────────────────────────────────────────────────

/** Which horizon an unpaid instalment falls in, or NULL for beyond the last one. */
function horizonOf(dates: FinanceDates, monthEnd: string, horizon: string): SQL<string | null> {
  return sql<string | null>`case
    when ${awardInstalments.dueDate} < ${dates.today} then 'overdue'
    when ${awardInstalments.dueDate} <= ${monthEnd} then 'thisMonth'
    when ${awardInstalments.dueDate} <= ${horizon} then 'next3Months'
  end`
}

function upcomingWhere(): SQL {
  return and(
    sql`${awardInstalments.paidDate} is null`,
    sql`${awardInstalments.dueDate} is not null`,
    payableJoined(),
  )!
}

/** Each horizon's money and count — the panel's headline figures. */
function upcomingTotals(db: ReturnType<typeof getDb>, g: GrantsQuery, dates: FinanceDates) {
  const bucket = horizonOf(dates, endOfMonthIso(dates.today), addMonthsIso(dates.today, 3))
  return (
    db
      .select({
        bucket,
        total: sql<number>`coalesce(sum(${awardInstalments.amount}), 0)::float8`,
        count: sql<number>`(count(*))::int`,
      })
      .from(awardInstalments)
      .innerJoin(g, sql`${grantsCol('award_id')} = ${awardInstalments.awardId}`)
      // `group by 1`, not the expression again: drizzle binds the three dates as fresh
      // parameters each time it emits the CASE, and Postgres matches GROUP BY expressions
      // syntactically — so the repeated version is a different expression and it refuses.
      .where(upcomingWhere())
      .groupBy(sql`1`)
  )
}

/**
 * The first few payments in each horizon, by date. `row_number()` rather than a query
 * per bucket: this is a dozen rows however large the portfolio, which is the whole
 * reason the panel can stay honest without loading the schedule.
 */
function upcomingItems(db: ReturnType<typeof getDb>, g: GrantsQuery, dates: FinanceDates) {
  const bucket = horizonOf(dates, endOfMonthIso(dates.today), addMonthsIso(dates.today, 3))
  const ranked = db
    .select({
      bucket: bucket.as('bucket'),
      awardId: awardInstalments.awardId,
      organisationName: g.organisationName,
      programmeName: g.programmeName,
      dueDate: sql<string>`${awardInstalments.dueDate}`.as('due_date'),
      amount: sql<number>`${awardInstalments.amount}::float8`.as('amount'),
      rank: sql<number>`row_number() over (partition by ${bucket} order by ${awardInstalments.dueDate}, ${awardInstalments.id})`.as(
        'rank',
      ),
    })
    .from(awardInstalments)
    .innerJoin(g, sql`${grantsCol('award_id')} = ${awardInstalments.awardId}`)
    .where(upcomingWhere())
    .as('ranked')
  return db
    .select()
    .from(ranked)
    .where(sql`${ranked.rank} <= ${UPCOMING_SHOWN} and ${ranked.bucket} is not null`)
    .orderBy(sql`${ranked.dueDate} asc`)
}

type HorizonKey = 'overdue' | 'thisMonth' | 'next3Months'

function toUpcoming(
  totals: Array<{ bucket: string | null; total: number; count: number }>,
  items: Array<{
    bucket: string | null
    awardId: string
    organisationName: string
    programmeName: string | null
    dueDate: string
    amount: number
  }>,
) {
  const out = emptyUpcoming()
  for (const key of ['overdue', 'thisMonth', 'next3Months'] as HorizonKey[]) {
    const t = totals.find((x) => x.bucket === key)
    out[key] = {
      total: t?.total ?? 0,
      count: t?.count ?? 0,
      items: items
        .filter((i) => i.bucket === key)
        .map((i) => ({
          awardId: i.awardId,
          organisationName: i.organisationName,
          programmeName: i.programmeName,
          dueDate: i.dueDate,
          amount: i.amount,
        })),
    }
  }
  return out
}

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
