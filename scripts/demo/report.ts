// `pnpm demo:report` — put the grant reports through the REAL report pipeline.
//
// The second (and last) step that costs money. Each report runs report field mapping
// and the AI analysis: summary, alignment against what the application promised,
// alignment against the programme's goal, and the impact quantity extracted in the
// programme's own unit. As with applications, none of that is written by hand — the
// analysis is whatever the model makes of the narrative in lib/reports.ts.
//
// Reports auto-link to their grant on an exact `externalApplicationId` match, which is
// why each report carries the ORIGINAL application's reference. Promotion ticks the
// earliest open reporting milestone, so the Reports screen and the award's schedule
// agree without either being written directly.
//
// Resumable and safe to re-run: a report already submitted for a reference is skipped.

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../src/server/db'
import { reportIngests, reportSchedule, reports } from '../../drizzle/schema'
import { saveReportIngest, processReportIngest } from '../../src/server/reportMapping/ingest'
import { REPORTS } from './lib/reports'
import { APPLICATIONS } from './lib/applications'
import { ORG_BY_KEY, PROGRAMMES, contactEmail } from './lib/data'
import { loadSnapshot, warnIfStale, type ReportSnapshot } from './lib/snapshot'
import { daysFromNow, requireDemoClient, runScript, step, done } from './lib/shared'

const args = process.argv.slice(2)
const limit = Number(args.find((a) => a.startsWith('--limit'))?.split('=')[1] ?? Infinity)
const forceLive = args.includes('--live')

const PROGRAMME_BY_KEY = Object.fromEntries(PROGRAMMES.map((p) => [p.key, p]))

/** References already reported for this tenant, so a re-run does not re-pay. */
async function alreadyReported(clientId: string): Promise<Set<string>> {
  const rows = await getDb().execute(sql`
    select i.raw_payload->>'externalApplicationId' as ref
    from report_ingests i where i.client_id = ${clientId}
  `)
  return new Set(
    (rows.rows as Array<{ ref: string | null }>).map((r) => r.ref).filter(Boolean) as string[],
  )
}

/**
 * Insert a report from the recorded analysis, skipping the model call.
 *
 * Mirrors `createReportSubmissionFromCanonical`: same columns, same "earliest open
 * milestone" tick — the only difference is that the analysis is replayed rather than
 * recomputed. The milestone is marked met on the report's own submission date, not
 * today's, so a replayed dataset dates consistently.
 */
async function replayReport(
  ref: string,
  payload: Record<string, unknown>,
  snap: ReportSnapshot,
  clientId: string,
  submittedAt: Date,
) {
  const db = getDb()
  const grant = await db.execute(sql`
    select aw.id from awards aw
    join applications a on a.id = aw.application_id
    where aw.client_id = ${clientId} and a.external_application_id = ${ref}
    limit 1
  `)
  const awardId = (grant.rows as Array<{ id: string }>)[0]?.id
  if (!awardId) return { reportId: null, status: 'error' as const }

  const milestone = await db.query.reportSchedule.findFirst({
    where: (s, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
      andOp(eqOp(s.awardId, awardId), isNullOp(s.submittedDate)),
    orderBy: (s, { asc: ascOp }) => [ascOp(s.dueDate)],
  })

  const id = crypto.randomUUID()
  await db.insert(reports).values({
    id,
    clientId,
    awardId,
    scheduleId: milestone?.id ?? null,
    matchMethod: 'external_id',
    externalApplicationId: ref,
    organisationName: payload.organisationName as string,
    charityNumber: (payload.charityNumber as string | undefined) ?? null,
    companyNumber: (payload.companyNumber as string | undefined) ?? null,
    programmeName: (payload.programmeName as string | undefined) ?? null,
    amountAwarded: payload.amountAwarded != null ? String(payload.amountAwarded) : null,
    contactName: (payload.contactName as string | undefined) ?? null,
    contactEmail: (payload.contactEmail as string | undefined) ?? null,
    grantTitle: (payload.grantTitle as string | undefined) ?? null,
    grantPurpose: (payload.grantPurpose as string | undefined) ?? null,
    impactSummary: payload.impactSummary as string,
    challenges: (payload.challenges as string | undefined) ?? null,
    lessons: (payload.lessons as string | undefined) ?? null,
    caseStudies: (payload.caseStudies as string | undefined) ?? null,
    testimonials: (payload.testimonials as string | undefined) ?? null,
    beneficiaryCount: (payload.beneficiaryCount as number | undefined) ?? null,
    deliveryArea: (payload.deliveryArea as string | undefined) ?? null,
    responses: [],
    // ── the recorded analysis ──
    analysisStatus: snap.analysisStatus as 'analysed',
    aiSummary: snap.aiSummary,
    applicationAlignment: snap.applicationAlignment,
    programmeAlignment: snap.programmeAlignment,
    aiChallenges: snap.aiChallenges,
    aiLessons: snap.aiLessons,
    impactQuantity: snap.impactQuantity,
    impactQuantitySource: snap.impactQuantitySource,
    impactQuantityQuote: snap.impactQuantityQuote,
    impactUnitLabel: snap.impactUnitLabel,
    analysisDetail: snap.analysisDetail as never,
    analysedAt: snap.analysedAt ? new Date(snap.analysedAt) : null,
    submittedAt,
    createdAt: submittedAt,
  })

  if (milestone) {
    await db
      .update(reportSchedule)
      .set({ submittedDate: submittedAt.toISOString().slice(0, 10) })
      .where(eq(reportSchedule.id, milestone.id))
  }

  await db.insert(reportIngests).values({
    clientId,
    rawPayload: payload,
    status: 'complete',
    reportId: id,
    resolvedAt: submittedAt,
    createdAt: submittedAt,
  })

  return { reportId: id, status: 'complete' as const }
}

runScript('demo:report', async () => {
  const db = getDb()
  const client = await requireDemoClient()
  const clientId = client.id

  const done_ = await alreadyReported(clientId)
  if (done_.size > 0) console.log(`  resuming — ${done_.size} already submitted, skipping those`)

  const snapshot = forceLive ? null : loadSnapshot()
  if (snapshot) {
    warnIfStale(snapshot)
    console.log('  replaying the analysis snapshot — no model calls, no cost.')
  }

  let submitted = 0
  let skipped = 0
  const counts = { complete: 0, ai_proposed: 0, needs_review: 0, error: 0 }

  step(`Submitting ${REPORTS.length} grant reports`)

  for (const r of REPORTS) {
    if (submitted >= limit) break
    if (done_.has(r.ref)) {
      skipped++
      continue
    }

    const app = APPLICATIONS.find((a) => a.ref === r.ref)
    if (!app) {
      console.log(`  ✗ ${r.ref} — no such application in the fixture`)
      continue
    }
    const org = ORG_BY_KEY[app.org]!
    const programme = PROGRAMME_BY_KEY[app.programme]!

    // Keyed by canonical report field name where one exists, so the rule matcher
    // resolves on an exact key and the AI mapping fallback is never invoked. The
    // remaining questions land in `responses`, and are still read by the analysis.
    const payload: Record<string, unknown> = {
      externalApplicationId: r.ref,
      organisationName: org.name,
      impactSummary: r.impactSummary,
      charityNumber: org.charityNumber ?? undefined,
      companyNumber: org.companyNumber ?? undefined,
      programmeName: programme.name,
      amountAwarded: app.award?.amount,
      grantTitle: r.grantTitle,
      grantPurpose: app.award?.purpose,
      challenges: r.challenges,
      lessons: r.lessons,
      contactName: r.contactName,
      contactEmail: contactEmail(org),
      deliveryArea: r.deliveryArea,
    }
    if (r.beneficiaryCount != null) payload.beneficiaryCount = r.beneficiaryCount
    if (r.caseStudy) payload.caseStudies = r.caseStudy
    if (r.testimonial) payload.testimonials = r.testimonial

    // Strip the undefined optionals rather than sending nulls — an empty value does not
    // resolve a canonical field, and sending one would misrepresent what the grantee's
    // form actually asked.
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k]

    const t0 = Date.now()
    const when = daysFromNow(-r.submittedDaysAgo)
    const snap = snapshot?.reports[r.ref]

    let result: { ok: boolean; status?: string; reportId: string | null; error?: string }
    let ingestId: string | null = null
    if (snap) {
      const replayed = await replayReport(r.ref, payload, snap, clientId, when)
      result = {
        ok: replayed.reportId !== null,
        status: replayed.status,
        reportId: replayed.reportId,
      }
    } else {
      ingestId = await saveReportIngest({ clientId, payload })
      const live = await processReportIngest(ingestId)
      result = live.ok
        ? { ok: true, status: live.status, reportId: live.reportId }
        : { ok: false, reportId: null, error: live.error }
    }
    submitted++

    if (!result.ok) {
      counts.error++
      console.log(`  ✗ ${r.ref} — pipeline error: ${result.error ?? 'no grant matched'}`)
      continue
    }
    counts[result.status as keyof typeof counts]++

    if (result.reportId) {
      // The live path stamps `submittedAt = now()`; the fixture's dates are what make a
      // report look like it came in when the milestone fell due. (Replay already wrote
      // the right dates, so this is a no-op there.)
      await db
        .update(reports)
        .set({ submittedAt: when, createdAt: when })
        .where(eq(reports.id, result.reportId))
      if (ingestId) {
        await db
          .update(reportIngests)
          .set({ createdAt: when, resolvedAt: when })
          .where(eq(reportIngests.id, ingestId))
      }

      const row = await db.query.reports.findFirst({
        where: eq(reports.id, result.reportId),
        columns: {
          analysisStatus: true,
          impactQuantity: true,
          impactUnitLabel: true,
          impactQuantitySource: true,
          applicationAlignment: true,
          programmeAlignment: true,
        },
      })
      const appAlign = (row?.applicationAlignment as { score?: number } | null)?.score
      const progAlign = (row?.programmeAlignment as { score?: number } | null)?.score
      done(
        `${r.ref} ${org.name} — impact ${row?.impactQuantity ?? '—'} ${row?.impactUnitLabel ?? ''}` +
          ` (${row?.impactQuantitySource ?? 'none'}) · alignment app ${appAlign ?? '—'}` +
          ` / programme ${progAlign ?? '—'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      )
    } else {
      done(`${r.ref} — held (${result.status})`)
    }
  }

  step('Summary')
  console.log(`  submitted:   ${submitted}`)
  console.log(`  skipped:     ${skipped} (already present)`)
  console.log(`  linked:      ${counts.complete}`)
  console.log(`  ai-proposed: ${counts.ai_proposed}`)
  console.log(`  held:        ${counts.needs_review}`)
  console.log(`  errors:      ${counts.error}`)
})
