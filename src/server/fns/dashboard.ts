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
  grants,
  grantPayments,
  grantReports,
  reportSubmissions,
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

  const clientId = user.clientId
  const grantScope = clientId ? eq(grants.clientId, clientId) : undefined

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

    // Money: total awarded (all grants) and how many are still active.
    getDb()
      .select({
        totalAwarded: sql<string>`COALESCE(SUM(${grants.amountAwarded}), '0')`,
        activeGrants: sql<number>`COUNT(*) FILTER (WHERE ${grants.status} = 'active')`,
      })
      .from(grants)
      .where(grantScope),

    // Awarded amount by programme (for the donut), via the awarded application.
    getDb()
      .select({
        programmeName: programmes.name,
        amount: sql<string>`COALESCE(SUM(${grants.amountAwarded}), '0')`,
      })
      .from(grants)
      .innerJoin(applications, eq(grants.applicationId, applications.id))
      .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(grantScope)
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
        id: reportSubmissions.id,
        grantReportId: reportSubmissions.grantReportId,
        organisationName: applications.organisationName,
        at: reportSubmissions.submittedAt,
      })
      .from(reportSubmissions)
      .innerJoin(grants, eq(reportSubmissions.grantId, grants.id))
      .leftJoin(applications, eq(grants.applicationId, applications.id))
      .where(grantScope)
      .orderBy(desc(reportSubmissions.submittedAt))
      .limit(8),

    // Recent report reviews (activity feed). Derived from reviewedAt, so an
    // undone review simply drops out of the feed.
    getDb()
      .select({
        id: reportSubmissions.id,
        grantReportId: reportSubmissions.grantReportId,
        organisationName: applications.organisationName,
        at: reportSubmissions.reviewedAt,
        by: reportSubmissions.reviewedBy,
      })
      .from(reportSubmissions)
      .innerJoin(grants, eq(reportSubmissions.grantId, grants.id))
      .leftJoin(applications, eq(grants.applicationId, applications.id))
      .where(and(grantScope, isNotNull(reportSubmissions.reviewedAt)))
      .orderBy(desc(reportSubmissions.reviewedAt))
      .limit(8),

    // Outstanding grant reports, soonest first.
    getDb()
      .select({
        grantId: grantReports.grantId,
        applicationId: grants.applicationId,
        organisationName: applications.organisationName,
        label: grantReports.label,
        dueDate: grantReports.dueDate,
      })
      .from(grantReports)
      .innerJoin(grants, eq(grantReports.grantId, grants.id))
      .leftJoin(applications, eq(grants.applicationId, applications.id))
      .where(and(grantScope, sql`${grantReports.submittedDate} IS NULL`, isNotNull(grantReports.dueDate)))
      .orderBy(grantReports.dueDate),

    // Outstanding (unpaid) grant payments, soonest first.
    getDb()
      .select({
        grantId: grantPayments.grantId,
        applicationId: grants.applicationId,
        organisationName: applications.organisationName,
        instalmentNo: grantPayments.instalmentNo,
        amount: grantPayments.amount,
        dueDate: grantPayments.dueDate,
      })
      .from(grantPayments)
      .innerJoin(grants, eq(grantPayments.grantId, grants.id))
      .leftJoin(applications, eq(grants.applicationId, applications.id))
      .where(and(grantScope, sql`${grantPayments.paidDate} IS NULL`, isNotNull(grantPayments.dueDate)))
      .orderBy(grantPayments.dueDate),

    // Paid-to-date / outstanding totals across all scheduled instalments (any due date).
    getDb()
      .select({
        paid: sql<string>`COALESCE(SUM(${grantPayments.amount}) FILTER (WHERE ${grantPayments.paidDate} IS NOT NULL), '0')`,
        outstanding: sql<string>`COALESCE(SUM(${grantPayments.amount}) FILTER (WHERE ${grantPayments.paidDate} IS NULL), '0')`,
      })
      .from(grantPayments)
      .innerJoin(grants, eq(grantPayments.grantId, grants.id))
      .where(grantScope),

    // Count of trustees for the client (denominator for the vote majority).
    clientId
      ? getDb()
          .select({ count: count() })
          .from(users)
          .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId)))
      : Promise.resolve([{ count: 0 }]),
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
  if (roundRows.length > 0) {
    const roundIds = roundRows.map((r) => r.id)
    const [appCountRows, budgetRows, funnelRows] = await Promise.all([
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
          committed: sql<string>`COALESCE(SUM(CASE WHEN ${applications.status} IN ('shortlisted','awarded') THEN COALESCE(${grants.amountAwarded}, ${applications.amountRequested}) ELSE 0 END), '0')`,
        })
        .from(roundProgrammes)
        .leftJoin(applications, eq(applications.roundProgrammeId, roundProgrammes.id))
        .leftJoin(grants, eq(grants.applicationId, applications.id))
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
      reportKey: r.grantReportId ?? r.id,
      organisationName: r.organisationName ?? '(direct grant)',
      at: r.at,
    })),
    ...recentReviewedRows.map((r) => ({
      type: 'report_reviewed' as const,
      reportKey: r.grantReportId ?? r.id,
      organisationName: r.organisationName ?? '(direct grant)',
      by: r.by,
      at: r.at!,
    })),
  ]
    .filter((a) => a.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8)

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
