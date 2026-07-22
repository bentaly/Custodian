import { createServerFn } from '@tanstack/react-start'
import { and, eq, count, inArray, sql, isNotNull, desc } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applications,
  rounds,
  roundProgrammes,
  programmes,
  applicationVotes,
  users,
  awards,
  awardInstalments,
  reportSchedule,
  reports,
  auditLog,
} from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { visibleRoundProgrammeIds } from '../scope'

// ISO yyyy-mm-dd in UTC for a given Date — grant payment/report due dates are stored
// as plain date strings, so we compare against the same representation.
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Monday-anchored ISO date for the week containing `d`. Used to bucket submissions.
function weekStart(d: Date): string {
  const day = (d.getUTCDay() + 6) % 7 // 0 = Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
  return isoDate(monday)
}

const SCORE_BANDS = [
  { key: '90plus', label: '90+', min: 90, max: 101 },
  { key: '80to89', label: '80–89', min: 80, max: 90 },
  { key: '70to79', label: '70–79', min: 70, max: 80 },
  { key: '60to69', label: '60–69', min: 60, max: 70 },
  { key: 'below60', label: '<60', min: 0, max: 60 },
] as const

/**
 * Everything the dashboard renders, in one client-scoped round trip. Aggregations are
 * pushed to the database where cheap; small lists (attention queue, recent activity)
 * are capped. All reads are scoped to the caller's client via the round-programme set
 * (null = superadmin, unrestricted).
 */
export const getDashboard = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  const rpScope = await visibleRoundProgrammeIds(user)

  // Non-superadmin with no accessible round-programmes: nothing to show.
  if (rpScope !== null && rpScope.length === 0) {
    return emptyDashboard(user.name)
  }

  const inScope = rpScope ? inArray(applications.roundProgrammeId, rpScope) : undefined
  const now = new Date()
  const todayIso = isoDate(now)
  const soonIso = isoDate(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000))
  // Submissions trend window: the last 12 ISO weeks.
  const trendStart = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  // Giving time windows (bucketed on awards.decisionAt). "This time last year" is the
  // same calendar day one year back, so the YoY comparison is like-for-like to date.
  const y = now.getUTCFullYear()
  const yearStart = new Date(Date.UTC(y, 0, 1))
  const lastYearStart = new Date(Date.UTC(y - 1, 0, 1))
  const lastYearToDate = new Date(Date.UTC(y - 1, now.getUTCMonth(), now.getUTCDate(), 23, 59, 59))
  const quarterStart = new Date(Date.UTC(y, Math.floor(now.getUTCMonth() / 3) * 3, 1))
  const monthStartIso = isoDate(new Date(Date.UTC(y, now.getUTCMonth(), 1)))
  const monthEndIso = isoDate(new Date(Date.UTC(y, now.getUTCMonth() + 1, 1)))

  const clientId = user.clientId
  const awardScope = clientId ? eq(awards.clientId, clientId) : undefined

  const [
    statusRows,
    scoreRows,
    submissionRows,
    roundRows,
    grantTotalsRows,
    byProgrammeRows,
    shortlistRows,
    reviewRows,
    recentSubmittedRows,
    recentDecidedRows,
    recentReportRows,
    recentReviewedRows,
    reportRows,
    paymentRows,
    paymentTotalsRows,
    trusteeCountRows,
    givingBucketRows,
    givingMonthlyRows,
    paymentsThisMonthRows,
    reportsToReviewRows,
    latelyRows,
  ] = await Promise.all([
    // Pipeline counts by status.
    getDb()
      .select({ status: applications.status, count: count() })
      .from(applications)
      .where(inScope)
      .groupBy(applications.status),

    // Custodian scores (scored only) for the distribution histogram.
    getDb()
      .select({ score: applications.custodianScore })
      .from(applications)
      .where(and(inScope, isNotNull(applications.custodianScore))),

    // Submission timestamps within the trend window, bucketed in JS.
    getDb()
      .select({ submittedAt: applications.submittedAt })
      .from(applications)
      .where(and(inScope, sql`${applications.submittedAt} >= ${trendStart}`)),

    // Rounds for this client, with their application counts.
    clientId
      ? getDb()
          .select({
            id: rounds.id,
            name: rounds.name,
            openedAt: rounds.openedAt,
            closedAt: rounds.closedAt,
          })
          .from(rounds)
          .where(eq(rounds.clientId, clientId))
          .orderBy(desc(rounds.openedAt))
      : Promise.resolve([] as Array<{ id: string; name: string; openedAt: Date | null; closedAt: Date | null }>),

    // Money: total awarded (all awards) and how many are still active.
    getDb()
      .select({
        totalAwarded: sql<string>`COALESCE(SUM(${awards.amountAwarded}), '0')`,
        activeGrants: sql<number>`COUNT(*) FILTER (WHERE ${awards.status} = 'active')`,
      })
      .from(awards)
      .where(awardScope),

    // Awarded amount by programme (for the donut), via the awarded application.
    getDb()
      .select({
        programmeName: programmes.name,
        amount: sql<string>`COALESCE(SUM(${awards.amountAwarded}), '0')`,
      })
      .from(awards)
      .innerJoin(applications, eq(awards.applicationId, applications.id))
      .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(awardScope)
      .groupBy(programmes.name),

    // Shortlisted applications with their yes-vote tally (for ready-to-award / awaiting-vote).
    getDb()
      .select({
        id: applications.id,
        organisationName: applications.organisationName,
        amountRequested: applications.amountRequested,
        score: applications.custodianScore,
        yesVotes: sql<number>`COUNT(*) FILTER (WHERE ${applicationVotes.vote} = 'yes')`,
        myVote: sql<number>`COUNT(*) FILTER (WHERE ${applicationVotes.userId} = ${user.id})`,
      })
      .from(applications)
      .leftJoin(applicationVotes, eq(applicationVotes.applicationId, applications.id))
      .where(and(inScope, eq(applications.status, 'shortlisted')))
      .groupBy(applications.id),

    // Applications awaiting first review.
    getDb()
      .select({
        id: applications.id,
        organisationName: applications.organisationName,
        submittedAt: applications.submittedAt,
        score: applications.custodianScore,
        scoreStatus: applications.custodianScoreStatus,
        dueDiligenceStatus: applications.dueDiligenceStatus,
      })
      .from(applications)
      .where(and(inScope, eq(applications.status, 'for_review')))
      .orderBy(desc(applications.submittedAt))
      .limit(6),

    // Recent submissions (for the activity feed).
    getDb()
      .select({
        id: applications.id,
        organisationName: applications.organisationName,
        at: applications.submittedAt,
      })
      .from(applications)
      .where(inScope)
      .orderBy(desc(applications.submittedAt))
      .limit(8),

    // Recent decisions (awarded / declined).
    getDb()
      .select({
        id: applications.id,
        organisationName: applications.organisationName,
        status: applications.status,
        at: applications.decisionAt,
      })
      .from(applications)
      .where(and(inScope, isNotNull(applications.decisionAt)))
      .orderBy(desc(applications.decisionAt))
      .limit(8),

    // Recent report submissions (for the activity feed).
    getDb()
      .select({
        id: reports.id,
        scheduleId: reports.scheduleId,
        organisationName: applications.organisationName,
        at: reports.submittedAt,
      })
      .from(reports)
      .innerJoin(awards, eq(reports.awardId, awards.id))
      .leftJoin(applications, eq(awards.applicationId, applications.id))
      .where(awardScope)
      .orderBy(desc(reports.submittedAt))
      .limit(8),

    // Recent report reviews (activity feed). Derived from reviewedAt, so an
    // undone review simply drops out of the feed.
    getDb()
      .select({
        id: reports.id,
        scheduleId: reports.scheduleId,
        organisationName: applications.organisationName,
        at: reports.reviewedAt,
        by: reports.reviewedBy,
      })
      .from(reports)
      .innerJoin(awards, eq(reports.awardId, awards.id))
      .leftJoin(applications, eq(awards.applicationId, applications.id))
      .where(and(awardScope, isNotNull(reports.reviewedAt)))
      .orderBy(desc(reports.reviewedAt))
      .limit(8),

    // Outstanding grant reports, soonest first.
    getDb()
      .select({
        awardId: reportSchedule.awardId,
        applicationId: awards.applicationId,
        organisationName: applications.organisationName,
        label: reportSchedule.label,
        dueDate: reportSchedule.dueDate,
      })
      .from(reportSchedule)
      .innerJoin(awards, eq(reportSchedule.awardId, awards.id))
      .leftJoin(applications, eq(awards.applicationId, applications.id))
      .where(and(awardScope, sql`${reportSchedule.submittedDate} IS NULL`, isNotNull(reportSchedule.dueDate)))
      .orderBy(reportSchedule.dueDate),

    // Outstanding (unpaid) grant payments, soonest first.
    getDb()
      .select({
        awardId: awardInstalments.awardId,
        applicationId: awards.applicationId,
        organisationName: applications.organisationName,
        instalmentNo: awardInstalments.instalmentNo,
        amount: awardInstalments.amount,
        dueDate: awardInstalments.dueDate,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awardInstalments.awardId, awards.id))
      .leftJoin(applications, eq(awards.applicationId, applications.id))
      .where(and(awardScope, sql`${awardInstalments.paidDate} IS NULL`, isNotNull(awardInstalments.dueDate)))
      .orderBy(awardInstalments.dueDate),

    // Paid-to-date / outstanding totals across all scheduled instalments (any due date).
    getDb()
      .select({
        paid: sql<string>`COALESCE(SUM(${awardInstalments.amount}) FILTER (WHERE ${awardInstalments.paidDate} IS NOT NULL), '0')`,
        outstanding: sql<string>`COALESCE(SUM(${awardInstalments.amount}) FILTER (WHERE ${awardInstalments.paidDate} IS NULL), '0')`,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awardInstalments.awardId, awards.id))
      .where(awardScope),

    // Count of trustees for the client (denominator for the vote majority).
    clientId
      ? getDb()
          .select({ count: count() })
          .from(users)
          .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId)))
      : Promise.resolve([{ count: 0 }]),

    // Giving buckets (on awards.decisionAt): all-time / YTD / this year to last year /
    // this quarter, plus a grant count — all for the "Giving so far" panel + YoY line.
    getDb()
      .select({
        allTime: sql<string>`COALESCE(SUM(${awards.amountAwarded}), '0')`,
        ytd: sql<string>`COALESCE(SUM(${awards.amountAwarded}) FILTER (WHERE ${awards.decisionAt} >= ${yearStart}), '0')`,
        lastYtd: sql<string>`COALESCE(SUM(${awards.amountAwarded}) FILTER (WHERE ${awards.decisionAt} >= ${lastYearStart} AND ${awards.decisionAt} <= ${lastYearToDate}), '0')`,
        quarter: sql<string>`COALESCE(SUM(${awards.amountAwarded}) FILTER (WHERE ${awards.decisionAt} >= ${quarterStart}), '0')`,
        grants: sql<number>`COUNT(*)`,
      })
      .from(awards)
      .where(awardScope),

    // Awarded amounts this calendar year, for the monthly giving series (bucketed in JS).
    getDb()
      .select({ decisionAt: awards.decisionAt, amount: awards.amountAwarded })
      .from(awards)
      .where(and(awardScope, sql`${awards.decisionAt} >= ${yearStart}`)),

    // Unpaid instalments falling due this calendar month (Finance KPI).
    getDb()
      .select({
        amount: sql<string>`COALESCE(SUM(${awardInstalments.amount}), '0')`,
        cnt: sql<number>`COUNT(*)`,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awardInstalments.awardId, awards.id))
      .where(
        and(
          awardScope,
          sql`${awardInstalments.paidDate} IS NULL`,
          sql`${awardInstalments.dueDate} >= ${monthStartIso}`,
          sql`${awardInstalments.dueDate} < ${monthEndIso}`,
        ),
      ),

    // Reports received but not yet signed off (Reports KPI: "to review").
    clientId
      ? getDb()
          .select({ count: count() })
          .from(reports)
          .where(and(eq(reports.clientId, clientId), sql`${reports.reviewedAt} IS NULL`))
      : Promise.resolve([{ count: 0 }]),

    // "Lately" feed — human actions from the audit log, newest first.
    clientId
      ? getDb()
          .select({
            id: auditLog.id,
            action: auditLog.action,
            applicationId: auditLog.applicationId,
            metadata: auditLog.metadata,
            at: auditLog.createdAt,
            actorName: users.name,
            organisationName: applications.organisationName,
          })
          .from(auditLog)
          .leftJoin(users, eq(auditLog.actorUserId, users.id))
          .leftJoin(applications, eq(auditLog.applicationId, applications.id))
          .where(eq(auditLog.clientId, clientId))
          .orderBy(desc(auditLog.createdAt))
          .limit(8)
      : Promise.resolve(
          [] as Array<{
            id: string
            action: string
            applicationId: string | null
            metadata: Record<string, unknown> | null
            at: Date
            actorName: string | null
            organisationName: string | null
          }>,
        ),
  ])

  // ── Pipeline ──────────────────────────────────────────────────────────────
  const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r.count]))
  const pipeline = {
    for_review: statusCounts.for_review ?? 0,
    shortlisted: statusCounts.shortlisted ?? 0,
    awarded: statusCounts.awarded ?? 0,
    declined: statusCounts.declined ?? 0,
    total: statusRows.reduce((s, r) => s + r.count, 0),
  }

  // ── Score distribution ──────────────────────────────────────────────────────
  const scoreDistribution = SCORE_BANDS.map((b) => ({
    key: b.key,
    label: b.label,
    count: scoreRows.filter((r) => r.score != null && r.score >= b.min && r.score < b.max).length,
  }))

  // ── Submissions trend (last 12 weeks, including empty weeks) ─────────────────
  const weekCounts = new Map<string, number>()
  for (let i = 11; i >= 0; i--) {
    const ws = weekStart(new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000))
    weekCounts.set(ws, 0)
  }
  for (const r of submissionRows) {
    if (!r.submittedAt) continue
    const ws = weekStart(new Date(r.submittedAt))
    if (weekCounts.has(ws)) weekCounts.set(ws, (weekCounts.get(ws) ?? 0) + 1)
  }
  const submissionsTrend = [...weekCounts.entries()].map(([weekStart, count]) => ({ weekStart, count }))

  // ── Money ────────────────────────────────────────────────────────────────
  const byProgramme = byProgrammeRows
    .map((r) => ({ name: r.programmeName, amount: parseFloat(r.amount) }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
  const money = {
    totalAwarded: parseFloat(grantTotalsRows[0]?.totalAwarded ?? '0'),
    paidToDate: parseFloat(paymentTotalsRows[0]?.paid ?? '0'),
    outstanding: parseFloat(paymentTotalsRows[0]?.outstanding ?? '0'),
    activeGrants: Number(grantTotalsRows[0]?.activeGrants ?? 0),
    byProgramme,
  }

  // ── Rounds with deadlines, application counts and budget utilisation ─────────
  // Focus round for the conversion funnel: the open round, else the most recent.
  const isRoundOpen = (r: { openedAt: Date | null; closedAt: Date | null }) =>
    (r.openedAt ? new Date(r.openedAt) <= now : false) && !(r.closedAt ? new Date(r.closedAt) <= now : false)
  const focusRound = roundRows.find(isRoundOpen) ?? roundRows[0] ?? null

  let roundsOut: DashboardRound[] = []
  let funnel: DashboardFunnel | null = null
  let focusRoundBreakdown: DashboardRoundBreakdown | null = null
  if (roundRows.length > 0) {
    const roundIds = roundRows.map((r) => r.id)
    const [appCountRows, budgetRows, funnelRows, focusProgrammeRows] = await Promise.all([
      getDb()
        .select({ roundId: roundProgrammes.roundId, count: count() })
        .from(applications)
        .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
        .where(inArray(roundProgrammes.roundId, roundIds))
        .groupBy(roundProgrammes.roundId),
      getDb()
        .select({
          roundId: roundProgrammes.roundId,
          budget: sql<string>`COALESCE(SUM(${roundProgrammes.budget}), '0')`,
          committed: sql<string>`COALESCE(SUM(CASE WHEN ${applications.status} IN ('shortlisted','awarded') THEN COALESCE(${awards.amountAwarded}, ${applications.amountRequested}) ELSE 0 END), '0')`,
        })
        .from(roundProgrammes)
        .leftJoin(applications, eq(applications.roundProgrammeId, roundProgrammes.id))
        .leftJoin(awards, eq(awards.applicationId, applications.id))
        .where(inArray(roundProgrammes.roundId, roundIds))
        .groupBy(roundProgrammes.roundId),
      // Status counts for the focus round only — the basis of the funnel.
      focusRound
        ? getDb()
            .select({ status: applications.status, count: count() })
            .from(applications)
            .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
            .where(eq(roundProgrammes.roundId, focusRound.id))
            .groupBy(applications.status)
        : Promise.resolve([] as Array<{ status: string; count: number }>),
      // Per-programme budget + committed for the focus round (the round rail donut/bars).
      focusRound
        ? getDb()
            .select({
              programmeName: programmes.name,
              budget: sql<string>`COALESCE(${roundProgrammes.budget}, '0')`,
              committed: sql<string>`COALESCE(SUM(CASE WHEN ${applications.status} IN ('shortlisted','awarded') THEN COALESCE(${awards.amountAwarded}, ${applications.amountRequested}) ELSE 0 END), '0')`,
            })
            .from(roundProgrammes)
            .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
            .leftJoin(applications, eq(applications.roundProgrammeId, roundProgrammes.id))
            .leftJoin(awards, eq(awards.applicationId, applications.id))
            .where(eq(roundProgrammes.roundId, focusRound.id))
            .groupBy(programmes.name, roundProgrammes.budget)
        : Promise.resolve([] as Array<{ programmeName: string; budget: string; committed: string }>),
    ])
    const appCountByRound = new Map(appCountRows.map((r) => [r.roundId, r.count]))
    const budgetByRound = new Map(budgetRows.map((r) => [r.roundId, r]))
    roundsOut = roundRows.map((r) => {
      const b = budgetByRound.get(r.id)
      return {
        id: r.id,
        name: r.name,
        openedAt: r.openedAt,
        closedAt: r.closedAt,
        applicationCount: appCountByRound.get(r.id) ?? 0,
        budget: b ? parseFloat(b.budget) : 0,
        committed: b ? parseFloat(b.committed) : 0,
      }
    })

    if (focusRound) {
      const fc = Object.fromEntries(funnelRows.map((r) => [r.status, r.count]))
      const awarded = fc.awarded ?? 0
      // Cumulative: a shortlisted or awarded application both *reached* the shortlist;
      // an awarded one *reached* the award. Declined sits outside the funnel.
      funnel = {
        roundName: focusRound.name,
        submitted: funnelRows.reduce((s, r) => s + r.count, 0),
        shortlisted: (fc.shortlisted ?? 0) + awarded,
        awarded,
        declined: fc.declined ?? 0,
      }

      const programmesOut = focusProgrammeRows
        .map((r) => ({
          name: r.programmeName,
          budget: parseFloat(r.budget),
          committed: parseFloat(r.committed),
        }))
        .sort((a, b) => b.budget - a.budget)
      focusRoundBreakdown = {
        roundId: focusRound.id,
        roundName: focusRound.name,
        closedAt: focusRound.closedAt,
        budget: programmesOut.reduce((s, p) => s + p.budget, 0),
        committed: programmesOut.reduce((s, p) => s + p.committed, 0),
        programmes: programmesOut,
      }
    }
  }

  // ── Attention queue ──────────────────────────────────────────────────────
  const trusteeCount = trusteeCountRows[0]?.count ?? 0
  const isTrustee = user.role === 'trustee'

  const shortlist = shortlistRows.map((r) => ({
    id: r.id,
    organisationName: r.organisationName,
    amountRequested: parseFloat(r.amountRequested),
    score: r.score,
    yesVotes: Number(r.yesVotes),
    iVoted: Number(r.myVote) > 0,
    hasMajority: trusteeCount > 0 && Number(r.yesVotes) * 2 > trusteeCount,
  }))

  const readyToAward = shortlist
    .filter((s) => s.hasMajority)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const awaitingMyVote = isTrustee ? shortlist.filter((s) => !s.iVoted) : []
  const shortlistProposed = shortlist.reduce((s, a) => s + a.amountRequested, 0)

  const reportsOverdue = reportRows.filter((r) => r.dueDate! < todayIso)
  const reportsDueSoon = reportRows.filter((r) => r.dueDate! >= todayIso && r.dueDate! <= soonIso)
  const paymentsOverdue = paymentRows.filter((p) => p.dueDate! < todayIso)
  const paymentsDueSoon = paymentRows.filter((p) => p.dueDate! >= todayIso && p.dueDate! <= soonIso)

  // Pipeline health: applications stuck pending automated checks.
  const scoringPending = reviewRows.filter((r) => r.scoreStatus === 'pending').length
  const dueDiligenceFlags = reviewRows.filter(
    (r) => r.dueDiligenceStatus === 'blocked' || r.dueDiligenceStatus === 'review',
  ).length

  // ── Recent activity (merge submissions + decisions + report events) ──────────
  // Report events are derived (submittedAt / reviewedAt), never logged: undoing a
  // review removes its feed item, re-reviewing re-dates it. `reportKey` is what
  // /reports/$reportKey accepts — the milestone id, or the submission id for
  // unscheduled reports.
  const activity = [
    ...recentSubmittedRows.map((r) => ({
      type: 'submitted' as const,
      applicationId: r.id,
      organisationName: r.organisationName,
      at: r.at,
    })),
    ...recentDecidedRows.map((r) => ({
      type: r.status === 'awarded' ? ('awarded' as const) : ('declined' as const),
      applicationId: r.id,
      organisationName: r.organisationName,
      at: r.at!,
    })),
    ...recentReportRows.map((r) => ({
      type: 'report_received' as const,
      reportKey: r.scheduleId ?? r.id,
      organisationName: r.organisationName ?? '(direct grant)',
      at: r.at,
    })),
    ...recentReviewedRows.map((r) => ({
      type: 'report_reviewed' as const,
      reportKey: r.scheduleId ?? r.id,
      organisationName: r.organisationName ?? '(direct grant)',
      by: r.by,
      at: r.at!,
    })),
  ]
    .filter((a) => a.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8)

  // ── KPI extras ───────────────────────────────────────────────────────────
  const submittedThisWeek = submissionRows.filter(
    (r) => r.submittedAt && new Date(r.submittedAt) >= weekAgo,
  ).length
  const awaitingVotes = shortlist.filter((s) => !s.hasMajority).length
  const paymentsThisMonth = {
    count: Number(paymentsThisMonthRows[0]?.cnt ?? 0),
    amount: parseFloat(paymentsThisMonthRows[0]?.amount ?? '0'),
  }
  const reportsToReview = reportsToReviewRows[0]?.count ?? 0

  // ── Giving so far (awards.decisionAt) ────────────────────────────────────
  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthly = MONTH_LABELS.slice(0, now.getUTCMonth() + 1).map((label) => ({ label, amount: 0 }))
  for (const r of givingMonthlyRows) {
    if (!r.decisionAt) continue
    const m = new Date(r.decisionAt).getUTCMonth()
    if (m <= now.getUTCMonth()) monthly[m]!.amount += parseFloat(r.amount)
  }
  const ytd = parseFloat(givingBucketRows[0]?.ytd ?? '0')
  const lastYtd = parseFloat(givingBucketRows[0]?.lastYtd ?? '0')
  const giving = {
    allTime: parseFloat(givingBucketRows[0]?.allTime ?? '0'),
    ytd,
    quarter: parseFloat(givingBucketRows[0]?.quarter ?? '0'),
    yoyDelta: ytd - lastYtd,
    grants: Number(givingBucketRows[0]?.grants ?? 0),
    monthly,
  }

  // ── Lately feed (audit log) ──────────────────────────────────────────────
  const lately = latelyRows.map((r) => ({
    id: r.id,
    action: r.action,
    applicationId: r.applicationId,
    organisationName: r.organisationName,
    actorName: r.actorName,
    amount: typeof r.metadata?.amount === 'number' ? (r.metadata.amount as number) : null,
    at: r.at,
  }))

  // Open round context for the greeting subtitle.
  const openRound = roundsOut.find((r) => {
    const opened = r.openedAt ? new Date(r.openedAt) <= now : false
    const closed = r.closedAt ? new Date(r.closedAt) <= now : false
    return opened && !closed
  })

  return {
    name: user.name,
    role: user.role,
    openRoundName: openRound?.name ?? null,
    pipeline,
    money,
    scoreDistribution,
    submissionsTrend,
    rounds: roundsOut,
    funnel,
    focusRoundBreakdown,
    submittedThisWeek,
    awaitingVotes,
    paymentsThisMonth,
    reportsToReview,
    giving,
    lately,
    attention: {
      toReview: { count: pipeline.for_review, items: reviewRows },
      awaitingMyVote: { count: awaitingMyVote.length, items: awaitingMyVote.slice(0, 5) },
      readyToAward: { count: readyToAward.length, items: readyToAward.slice(0, 5) },
      shortlist: { count: shortlist.length, proposed: shortlistProposed },
      reportsOverdue: { count: reportsOverdue.length, items: reportsOverdue.slice(0, 5) },
      reportsDueSoon: { count: reportsDueSoon.length },
      paymentsOverdue: { count: paymentsOverdue.length, items: paymentsOverdue.slice(0, 5) },
      paymentsDueSoon: { count: paymentsDueSoon.length },
      scoringPending,
      dueDiligenceFlags,
    },
    activity,
  }
})

type DashboardRound = {
  id: string
  name: string
  openedAt: Date | null
  closedAt: Date | null
  applicationCount: number
  budget: number
  committed: number
}

type DashboardFunnel = {
  roundName: string
  submitted: number
  shortlisted: number
  awarded: number
  declined: number
}

type DashboardRoundBreakdown = {
  roundId: string
  roundName: string
  closedAt: Date | null
  budget: number
  committed: number
  programmes: Array<{ name: string; budget: number; committed: number }>
}

function emptyDashboard(name: string) {
  return {
    name,
    role: 'observer' as string,
    openRoundName: null as string | null,
    pipeline: { for_review: 0, shortlisted: 0, awarded: 0, declined: 0, total: 0 },
    money: {
      totalAwarded: 0,
      outstanding: 0,
      paidToDate: 0,
      activeGrants: 0,
      byProgramme: [] as Array<{ name: string; amount: number }>,
    },
    scoreDistribution: SCORE_BANDS.map((b) => ({ key: b.key, label: b.label, count: 0 })),
    submissionsTrend: [] as Array<{ weekStart: string; count: number }>,
    rounds: [] as DashboardRound[],
    funnel: null as DashboardFunnel | null,
    focusRoundBreakdown: null as DashboardRoundBreakdown | null,
    submittedThisWeek: 0,
    awaitingVotes: 0,
    paymentsThisMonth: { count: 0, amount: 0 },
    reportsToReview: 0,
    giving: {
      allTime: 0,
      ytd: 0,
      quarter: 0,
      yoyDelta: 0,
      grants: 0,
      monthly: [] as Array<{ label: string; amount: number }>,
    },
    lately: [] as Array<{
      id: string
      action: string
      applicationId: string | null
      organisationName: string | null
      actorName: string | null
      amount: number | null
      at: Date
    }>,
    attention: {
      toReview: { count: 0, items: [] as never[] },
      awaitingMyVote: { count: 0, items: [] as never[] },
      readyToAward: { count: 0, items: [] as never[] },
      shortlist: { count: 0, proposed: 0 },
      reportsOverdue: { count: 0, items: [] as never[] },
      reportsDueSoon: { count: 0 },
      paymentsOverdue: { count: 0, items: [] as never[] },
      paymentsDueSoon: { count: 0 },
      scoringPending: 0,
      dueDiligenceFlags: 0,
    },
    activity: [] as never[],
  }
}
