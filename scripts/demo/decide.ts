// `pnpm demo:decide` — everything a foundation's people did to the applications.
//
// Statuses, trustee votes, discussion, the grants themselves, their payment schedules,
// their reporting milestones, the award letters as issued, and the audit trail that
// feeds the dashboard's "Lately" feed.
//
// Deliberately NOT routed through `createAwards`. That path is the right one for a
// decision being made now — it enforces the trustee majority, issues the letter by
// email and writes the audit trail — and the wrong one for a fact being recorded:
// it would email twenty-five charities about grants that do not exist. The award
// letters here are rendered with the real renderer and stored as `sent` with a
// backdated timestamp, so the award screen shows exactly what a grantee would have
// received, and nothing is delivered.
//
// Free to run, and idempotent: it clears its own decision layer first, so the votes
// and grants can be reshaped without re-paying for the applications underneath them.

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../src/server/db'
import {
  applicationComments,
  applicationVotes,
  applications,
  auditLog,
  awardInstalments,
  awardLetters,
  awards,
  reportSchedule,
  users,
} from '../../drizzle/schema'
import { renderAwardLetter } from '../../src/lib/awardLetter'
import { APPLICATIONS } from './lib/applications'
import { CLIENT, ORG_BY_KEY, PROGRAMMES, ROUNDS, contactEmail } from './lib/data'
import { daysFromNow, isoDate, requireDemoClient, runScript, step, done } from './lib/shared'

// ─── Who voted how ───────────────────────────────────────────────────────────
//
// Spread deliberately across every state the shortlist can show, because the decision
// pill counts DOWN ("2 votes needed" / "Last vote needed" / "Board approved") and a
// board's actual question is how far off a decision is. One shortlisted application is
// left with no votes at all, and one carries a dissent — a unanimous board is not a
// realistic one, and the screen should be seen holding a disagreement.
const VOTES: Record<string, { yes: string[]; no?: string[] }> = {
  // Past round — every awarded grant carried a majority.
  'WF-2025-004': { yes: ['priya', 'douglas', 'ngozi', 'tom'] },
  'WF-2025-011': { yes: ['priya', 'douglas', 'ngozi'], no: ['tom'] },
  'WF-2025-023': { yes: ['priya', 'douglas', 'tom'] },
  'WF-2025-007': { yes: ['priya', 'douglas', 'ngozi', 'tom'] },
  'WF-2025-014': { yes: ['douglas', 'ngozi', 'tom'] },
  'WF-2025-041': { yes: ['priya', 'ngozi', 'tom'] },
  'WF-2025-009': { yes: ['priya', 'douglas', 'ngozi', 'tom'] },
  'WF-2025-025': { yes: ['priya', 'douglas', 'ngozi'], no: ['tom'] },
  'WF-2025-012': { yes: ['priya', 'douglas', 'ngozi', 'tom'] },

  // Open round — mid-vote, every state represented.
  'WF-2026-003': { yes: ['priya', 'douglas', 'ngozi', 'tom'] }, // board approved
  'WF-2026-006': { yes: ['priya', 'douglas', 'ngozi'] }, // board approved
  'WF-2026-009': { yes: ['priya', 'douglas', 'ngozi'] }, // board approved
  'WF-2026-008': { yes: ['priya', 'douglas'] }, // last vote needed
  'WF-2026-005': { yes: ['douglas', 'ngozi'], no: ['tom'] }, // last vote needed, with dissent
  'WF-2026-013': { yes: ['priya'] }, // 2 votes needed
  'WF-2026-015': { yes: ['ngozi'] }, // 2 votes needed
  'WF-2026-014': { yes: ['priya', 'tom'] }, // last vote needed
  'WF-2026-011': { yes: [] }, // nobody has voted yet
}

// ─── Discussion ──────────────────────────────────────────────────────────────
//
// Comments are a count that opens a dialog rather than a bare input, so the demo needs
// threads with more than one voice in them — a single comment per application would
// never show the thing the dialog exists for.
const COMMENTS: Record<string, Array<{ by: string; daysAgo: number; body: string }>> = {
  'WF-2026-003': [
    {
      by: 'priya',
      daysAgo: 20,
      body: 'The first two teams have done what they said they would. I would fund the third without much hesitation — the council match from 2027 makes the exit credible.',
    },
    {
      by: 'tom',
      daysAgo: 18,
      body: 'Agreed on delivery. My only question is whether Central and Talbot are genuinely underserved or whether the youth justice figures are driven by something else. Helen, is there ward-level data?',
    },
    {
      by: 'helen',
      daysAgo: 17,
      body: 'Asked them — they have sent the ward breakdown and it holds up. Central is the highest in the borough for first-time entrants and has no open-access provision at all.',
    },
  ],
  'WF-2026-005': [
    {
      by: 'tom',
      daysAgo: 15,
      body: 'I am not against this, but we are being asked to fund a third geography before the second has reported. I would rather wait a year.',
    },
    {
      by: 'ngozi',
      daysAgo: 14,
      body: 'The Rhondda numbers are strong enough that I am comfortable. 121 sets of works from 268 cases is a real rate.',
    },
    {
      by: 'douglas',
      daysAgo: 13,
      body: 'Both fair. I have voted to approve on the basis that the two councils are watching this and will not commission without it running locally first.',
    },
  ],
  'WF-2026-011': [
    {
      by: 'priya',
      daysAgo: 9,
      body: 'Worth noting they have taken the feedback from last year seriously — this is a straight replacement of the voucher scheme rather than a defence of it. That counts for something.',
    },
  ],
  'WF-2026-013': [
    {
      by: 'ngozi',
      daysAgo: 12,
      body: 'The Nant Morlais precedent is the strongest evidence in this round. 71% reduction in zinc with trout returning is a hard outcome, not an aspiration.',
    },
    {
      by: 'priya',
      daysAgo: 10,
      body: 'Does the Coal Authority adoption agreement exist in writing, or is it an understanding? That is the whole sustainability case.',
    },
  ],
  'WF-2026-015': [
    {
      by: 'douglas',
      daysAgo: 11,
      body: 'Fourteen partner projects already taking output is the part that persuades me. This is not building demand, it is meeting it.',
    },
  ],
  'WF-2025-009': [
    {
      by: 'priya',
      daysAgo: 340,
      body: 'Anglian Water at the table changes the risk profile considerably. Recommend we proceed with the consent condition attached.',
    },
  ],
  'WF-2026-021': [
    {
      by: 'helen',
      daysAgo: 8,
      body: 'This is the third year running we have had essentially the same application from Lighthouse. I have offered them a conversation before the panel meets.',
    },
  ],
  'WF-2026-019': [
    {
      by: 'ngozi',
      daysAgo: 7,
      body: 'Strong technically. The question for the panel is whether 210 hectares of blanket bog sits within Wild Rivers or whether we are drifting into a carbon programme we have not agreed.',
    },
  ],
}

/** When a round's decisions were made, as days ago. */
function decisionDayFor(round: string): number {
  return ROUNDS.find((r) => r.key === round)?.decidedDaysAgo ?? 30
}

runScript('demo:decide', async () => {
  const db = getDb()
  const client = await requireDemoClient()
  const clientId = client.id

  // ── Look-ups ───────────────────────────────────────────────────────────────
  const staff = await db.query.users.findMany({ where: eq(users.clientId, clientId) })
  const userByKey: Record<string, string> = {}
  for (const u of staff) {
    const key = u.email.split('@')[0]!
    userByKey[key] = u.id
  }
  const adminId = userByKey['helen']!

  const appRows = await db.execute(sql`
    select a.id, a.external_application_id ref, ro.name round_name, p.name programme_name
    from applications a
    join round_programmes rp on rp.id = a.round_programme_id
    join rounds ro on ro.id = rp.round_id
    join programmes p on p.id = rp.programme_id
    where ro.client_id = ${clientId}
  `)
  const byRef = new Map<string, { id: string; round: string; programme: string }>()
  for (const r of appRows.rows as Array<Record<string, string>>) {
    byRef.set(r.ref!, { id: r.id!, round: r.round_name!, programme: r.programme_name! })
  }
  if (byRef.size === 0) throw new Error('No applications found — run `pnpm demo:apply` first.')
  done(`${byRef.size} applications found`)

  // ── Clear the previous decision layer ──────────────────────────────────────
  //
  // Only what THIS script creates. The applications and their AI columns are left
  // alone: they cost money and are not ours to throw away here.
  //
  // Grants are the exception, and the trap. `reports.award_id` cascades, so deleting
  // and rebuilding the grants takes every grant report with it — including the AI
  // analysis that `demo:report` paid for. So once reports exist the grant layer is
  // preserved by default, and rebuilding it is something you have to ask for.
  const reportCount = Number(
    (
      (await db.execute(sql`select count(*)::int n from reports where client_id = ${clientId}`))
        .rows as Array<{ n: number }>
    )[0]?.n ?? 0,
  )
  const rebuildGrants = process.argv.includes('--rebuild-grants')
  const keepGrants = reportCount > 0 && !rebuildGrants

  if (keepGrants) {
    console.log(
      `\n  ${reportCount} grant reports exist — keeping the existing grants, since deleting\n` +
        '  them would cascade and destroy the reports. Everything else is rebuilt.\n' +
        '  Pass --rebuild-grants to rebuild anyway (the reports go, and `pnpm demo:report`\n' +
        '  has to run again at full cost).',
    )
  }

  step('Clearing the previous decision layer')
  // Scoped by subselect from the client rather than by an id array — the neon-http
  // driver cannot bind a JS array to `= any(...)`, and a subselect keeps the tenant
  // scope in SQL where it cannot drift.
  const ownApplications = sql`
    select a.id from applications a
    join round_programmes rp on rp.id = a.round_programme_id
    join rounds ro on ro.id = rp.round_id
    where ro.client_id = ${clientId}
  `
  if (!keepGrants) {
    // Clearing the report ingests too: without it a later `demo:report` would see the
    // reference already present, skip it, and leave the rebuilt grant with no report.
    await db.execute(sql`delete from report_ingests where client_id = ${clientId}`)
    await db.execute(sql`delete from award_letters where client_id = ${clientId}`)
    await db.execute(
      sql`delete from award_instalments where award_id in (select id from awards where client_id = ${clientId})`,
    )
    await db.execute(
      sql`delete from report_schedule where award_id in (select id from awards where client_id = ${clientId})`,
    )
    await db.execute(sql`delete from awards where client_id = ${clientId}`)
  }
  await db.execute(sql`delete from audit_log where client_id = ${clientId}`)
  await db.execute(sql`delete from application_votes where application_id in (${ownApplications})`)
  await db.execute(
    sql`delete from application_comments where application_id in (${ownApplications})`,
  )
  done('cleared')

  // ── Round budgets ──────────────────────────────────────────────────────────
  //
  // Re-asserted from the fixture rather than left as `demo:seed` wrote them. Budgets
  // are the number every "committed of budget" bar is drawn against, and getting them
  // right is a matter of looking at the result and adjusting — which must not mean
  // re-running the applications underneath at full cost. Retuning is free from here.
  step('Syncing round budgets')
  for (const r of ROUNDS) {
    for (const [programmeKey, b] of Object.entries(r.budgets)) {
      await db.execute(sql`
        update round_programmes rp
        set budget = ${String(b.budget)},
            max_grant_amount = ${String(b.maxGrant)},
            grant_duration_years = ${b.years}
        from rounds ro, programmes p
        where rp.round_id = ro.id and rp.programme_id = p.id
          and ro.client_id = ${clientId} and ro.name = ${r.name}
          and p.name = ${PROGRAMMES.find((x) => x.key === programmeKey)!.name}
      `)
    }
  }
  done('budgets and grant ceilings applied')

  // ── Statuses and decision dates ────────────────────────────────────────────
  step('Setting application statuses')
  const auditRows: Array<typeof auditLog.$inferInsert> = []
  const tally: Record<string, number> = {}

  for (const app of APPLICATIONS) {
    const row = byRef.get(app.ref)
    if (!row) continue
    tally[app.outcome] = (tally[app.outcome] ?? 0) + 1

    // Decisions are made by ROUND, together, some weeks after it closes.
    const decidedDaysAgo = decisionDayFor(app.round)
    const decided =
      app.outcome === 'awarded' || app.outcome === 'declined' ? daysFromNow(-decidedDaysAgo) : null

    await db
      .update(applications)
      .set({ status: app.outcome, decisionAt: decided })
      .where(eq(applications.id, row.id))

    if (app.outcome === 'shortlisted' || app.outcome === 'awarded') {
      auditRows.push({
        clientId,
        actorUserId: adminId,
        action: 'application_shortlisted',
        applicationId: row.id,
        createdAt: daysFromNow(-(decidedDaysAgo + 10)),
      })
    }
    if (app.outcome === 'declined') {
      auditRows.push({
        clientId,
        actorUserId: adminId,
        action: 'application_declined',
        applicationId: row.id,
        createdAt: decided!,
      })
    }
  }
  done(
    Object.entries(tally)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', '),
  )

  // ── Votes ──────────────────────────────────────────────────────────────────
  step('Recording trustee votes')
  let voteCount = 0
  for (const [ref, v] of Object.entries(VOTES)) {
    const row = byRef.get(ref)
    if (!row) continue
    const app = APPLICATIONS.find((a) => a.ref === ref)!
    const base = Math.max(2, app.submittedDaysAgo - 50)
    let i = 0
    for (const who of v.yes) {
      await db.insert(applicationVotes).values({
        applicationId: row.id,
        userId: userByKey[who]!,
        vote: 'yes',
        createdAt: daysFromNow(-(base - i++)),
      })
      voteCount++
    }
    for (const who of v.no ?? []) {
      await db.insert(applicationVotes).values({
        applicationId: row.id,
        userId: userByKey[who]!,
        vote: 'no',
        createdAt: daysFromNow(-(base - i++)),
      })
      voteCount++
    }
  }
  done(`${voteCount} votes across ${Object.keys(VOTES).length} applications`)

  // ── Comments ───────────────────────────────────────────────────────────────
  step('Adding discussion')
  let commentCount = 0
  for (const [ref, thread] of Object.entries(COMMENTS)) {
    const row = byRef.get(ref)
    if (!row) continue
    for (const c of thread) {
      const at = daysFromNow(-c.daysAgo)
      await db.insert(applicationComments).values({
        applicationId: row.id,
        userId: userByKey[c.by]!,
        body: c.body,
        createdAt: at,
      })
      auditRows.push({
        clientId,
        actorUserId: userByKey[c.by]!,
        action: 'application_commented',
        applicationId: row.id,
        createdAt: at,
      })
      commentCount++
    }
  }
  done(`${commentCount} comments across ${Object.keys(COMMENTS).length} threads`)

  // ── Grants ─────────────────────────────────────────────────────────────────
  step('Minting grants')
  const profile = await db.query.clientProfiles.findFirst({
    where: (p, { eq: e }) => e(p.clientId, clientId),
  })
  const programmeByKey = Object.fromEntries(PROGRAMMES.map((p) => [p.key, p]))
  let grantCount = 0
  let instalmentCount = 0
  let paidCount = 0

  for (const app of APPLICATIONS) {
    if (app.outcome !== 'awarded' || !app.award) continue
    const row = byRef.get(app.ref)
    if (!row) continue

    // The audit entry is rebuilt either way — the "Lately" feed is ours to regenerate,
    // and it was cleared above. Only the grant itself is preserved.
    if (keepGrants) {
      auditRows.push({
        clientId,
        actorUserId: adminId,
        action: 'application_awarded',
        applicationId: row.id,
        metadata: { amount: app.award.amount },
        createdAt: daysFromNow(-Math.max(1, app.submittedDaysAgo - 45)),
      })
      continue
    }

    const org = ORG_BY_KEY[app.org]!
    const a = app.award
    // The decision date comes from the ROUND, not the application — a round decides its
    // applications together, and it is those clustered dates, four times a year, that
    // give the dashboard's giving-over-time chart its rhythm.
    const decidedDaysAgo = decisionDayFor(app.round)
    const startDate = daysFromNow(-a.startDaysAgo)

    const [award] = await db
      .insert(awards)
      .values({
        applicationId: row.id,
        clientId,
        amountAwarded: String(a.amount),
        status: a.status ?? 'active',
        purpose: a.purpose,
        specialCondition: a.conditions?.length ? a.conditions.join('\n') : null,
        startDate: isoDate(startDate),
        decisionAt: daysFromNow(-decidedDaysAgo),
        createdAt: daysFromNow(-decidedDaysAgo),
      })
      .returning({ id: awards.id })
    const awardId = award!.id
    grantCount++

    // The schedule as the fixture states it — dates relative to the grant start, and
    // whether each has been paid. A single entry is a one-off payment.
    const count = a.instalments.length
    const per = Math.round((a.amount / count) * 100) / 100
    const instalments: Array<{ amount: number; dueDate: string }> = []
    for (const [n, plan] of a.instalments.entries()) {
      // Last instalment absorbs the rounding so the schedule sums to the award exactly.
      const amount = n === count - 1 ? a.amount - per * (count - 1) : per
      const due = daysFromNow(-a.startDaysAgo + plan.daysFromStart)
      instalments.push({ amount, dueDate: isoDate(due) })
      await db.insert(awardInstalments).values({
        awardId,
        instalmentNo: n + 1,
        amount: String(amount),
        dueDate: isoDate(due),
        // Paid a few days after it fell due. An instalment marked unpaid whose date has
        // already passed is what puts a real arrears case in front of Finance — the
        // fixture sets one deliberately.
        paidDate: plan.paid ? isoDate(daysFromNow(-a.startDaysAgo + plan.daysFromStart + 4)) : null,
      })
      instalmentCount++
      if (plan.paid) paidCount++
    }

    // Reporting milestones. `submittedDate` is deliberately left null even for the ones
    // marked received — `pnpm demo:report` ticks them by putting a real report through
    // the report pipeline, which is what does it in production.
    for (const r of a.reports) {
      await db.insert(reportSchedule).values({
        awardId,
        label: r.label,
        dueDate: isoDate(daysFromNow(-r.dueDaysAgo)),
      })
    }

    // The letter, rendered with the real renderer and stored as the snapshot it is.
    const programme = programmeByKey[app.programme]!
    const roundName = ROUNDS.find((r) => r.key === app.round)!.name
    const letter = renderAwardLetter({
      input: {
        organisationName: org.name,
        foundationName: CLIENT.name,
        amountAwarded: a.amount,
        purpose: a.purpose,
        startDate: isoDate(startDate),
        programmeName: programme.name,
        roundName,
        reference: app.ref,
        instalments: instalments.map((i) => ({ amount: i.amount, dueDate: i.dueDate })),
        reporting: a.reports.map((r) => ({
          label: r.label,
          dueDate: isoDate(daysFromNow(-r.dueDaysAgo)),
        })),
        signatory: profile?.awardLetterSignatory ?? null,
        issuedAt: daysFromNow(-decidedDaysAgo),
      },
      settings: {
        template: profile?.awardLetterTemplate ?? null,
        conditions: profile?.awardLetterConditions ?? null,
        signatory: profile?.awardLetterSignatory ?? null,
      },
      specialCondition: a.conditions?.length ? a.conditions.join('\n') : null,
    })

    await db.insert(awardLetters).values({
      awardId,
      clientId,
      subject: letter.subject,
      bodyText: letter.bodyText,
      bodyHtml: letter.bodyHtml,
      conditions: letter.conditions,
      // Recorded as sent — with a backdated timestamp — because that is what happened
      // in the story this dataset tells. Nothing is actually delivered by this script.
      status: 'sent',
      recipientEmail: contactEmail(org),
      replyTo: profile?.awardLetterReplyTo ?? null,
      senderName: profile?.awardLetterSenderName ?? CLIENT.name,
      sentAt: daysFromNow(-decidedDaysAgo),
      createdAt: daysFromNow(-decidedDaysAgo),
    })

    auditRows.push({
      clientId,
      actorUserId: adminId,
      action: 'application_awarded',
      applicationId: row.id,
      metadata: { amount: a.amount },
      createdAt: daysFromNow(-decidedDaysAgo),
    })
  }
  done(
    keepGrants
      ? 'grants preserved (reports depend on them) — pass --rebuild-grants to rebuild'
      : `${grantCount} grants · ${instalmentCount} instalments (${paidCount} paid)`,
  )

  // ── Audit trail ────────────────────────────────────────────────────────────
  step('Writing the audit trail')
  for (const r of auditRows) await db.insert(auditLog).values(r)
  done(`${auditRows.length} entries`)
})
