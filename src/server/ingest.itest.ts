import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'

// The queue is stubbed: nothing here may spend a model call, and a scoring message
// enqueued from a test would run in the background after the tenant is torn down.
vi.mock('./pipelineQueue', () => ({
  enqueue: async () => {},
  enqueueMany: async () => {},
}))

import { getDb } from './db'
import { assertWritableDatabase } from '../../scripts/demo/lib/shared'
import { teardownDemo } from '../../scripts/demo/lib/teardown'
import { saveIngest, processIngest } from './fieldMapping/ingest'
import { resolveIngest } from './fieldMapping/resolve'
import { diagnoseIngests } from './fieldMapping/diagnose'
import { saveReportIngest, processReportIngest } from './reportMapping/ingest'
import { moveReport, returnReport } from './reports/correct'
import { reportsAsSent } from './reports/asSent'
import { parseSubmissionPayload } from '../lib/submissionPayload'
import {
  applicationEdits,
  applicationIngests,
  applications,
  awards,
  clients,
  programmes,
  reportIngests,
  reportSchedule,
  reports,
  roundProgrammes,
  rounds,
  users,
} from '../../drizzle/schema'

/**
 * Both submission pipelines, end to end, against a real database: what a submission
 * becomes (an application, a report, a held row, or nothing) is decided across the
 * mapper, the validators, the matcher, the de-duplication and several tables, and the
 * offline suite can only see each piece alone.
 *
 * Offline in every other sense. The AI, Google and register keys are removed from this
 * process, so each paid feature degrades exactly as it does in production without its
 * key (mapping falls back to rules, scoring and analysis to `pending`), and payloads
 * carry no charity number or delivery area where a lookup would otherwise go out.
 *
 * Builds one tenant (plus a bare second one for the cross-tenant case) and tears both
 * down, like `tenancy.itest.ts`. Every reference and charity number carries this run's
 * marker, so concurrent runs cannot see each other's rows.
 */

const RUN = randomUUID().slice(0, 8)
const M = `itest-${RUN}`
/** A charity number unique to this run: seven digits, as the register issues them. */
const charity = (n: number) => `9${RUN.replace(/[^0-9]/g, '').padEnd(4, '0').slice(0, 4)}${n}${n}`

let clientId = ''
let otherClientId = ''
let youthRp = ''
let actor = { id: '' }

/** Awarded grants for the report side, keyed by name. */
const grants: Record<string, { awardId: string; applicationId: string; milestones: string[] }> =
  {}

async function makeGrant(
  name: string,
  opts: { reference: string; charityNumber: string; rp: string; milestones: number; answered?: number },
) {
  const db = getDb()
  const [app] = await db
    .insert(applications)
    .values({
      roundProgrammeId: opts.rp,
      organisationName: `${name} ${M}`,
      externalApplicationId: opts.reference,
      charityNumber: opts.charityNumber,
      amountRequested: '10000',
      status: 'awarded',
    })
    .returning()
  const [award] = await db
    .insert(awards)
    .values({ applicationId: app!.id, clientId, amountAwarded: '10000' })
    .returning()
  const milestones: string[] = []
  for (let i = 0; i < opts.milestones; i++) {
    const [m] = await db
      .insert(reportSchedule)
      .values({
        awardId: award!.id,
        label: i === opts.milestones - 1 ? 'Final report' : `Report ${i + 1}`,
        dueDate: `2027-0${i + 1}-01`,
        submittedDate: i < (opts.answered ?? 0) ? '2026-01-01' : null,
      })
      .returning()
    milestones.push(m!.id)
  }
  grants[name] = { awardId: award!.id, applicationId: app!.id, milestones }
}

beforeAll(async () => {
  assertWritableDatabase()
  for (const key of [
    'ANTHROPIC_API_KEY',
    'GOOGLE_MAPS_API_KEY',
    'CHARITY_COMMISSION_KEY',
    'COMPANIES_HOUSE_KEY',
  ]) {
    delete process.env[key]
  }

  const db = getDb()
  const [client] = await db.insert(clients).values({ name: `Ingest fixture ${M}` }).returning()
  clientId = client!.id
  const [other] = await db.insert(clients).values({ name: `Ingest other ${M}` }).returning()
  otherClientId = other!.id

  const [youth] = await db
    .insert(programmes)
    .values({ clientId, name: `Youth ${M}` })
    .returning()
  const [arts] = await db
    .insert(programmes)
    .values({ clientId, name: `Arts ${M}` })
    .returning()
  const [round] = await db
    .insert(rounds)
    .values({
      clientId,
      name: `Round ${M}`,
      openedAt: new Date(Date.now() - 86_400_000),
      closedAt: new Date(Date.now() + 30 * 86_400_000),
    })
    .returning()
  const [rpYouth] = await db
    .insert(roundProgrammes)
    .values({ roundId: round!.id, programmeId: youth!.id, budget: '100000' })
    .returning()
  const [rpArts] = await db
    .insert(roundProgrammes)
    .values({ roundId: round!.id, programmeId: arts!.id, budget: '100000' })
    .returning()
  youthRp = rpYouth!.id

  const [user] = await db
    .insert(users)
    .values({
      id: `itest-${RUN}`,
      name: 'Ingest test',
      email: `${M}@example.com`,
      role: 'admin',
      clientId,
    })
    .returning()
  actor = { id: user!.id }

  // One charity, one grant waiting on a report.
  // Three milestones: the tests below use them up in turn.
  await makeGrant('Solo', {
    reference: `SOLO-${M}`,
    charityNumber: charity(1),
    rp: rpYouth!.id,
    milestones: 3,
  })
  // One charity, two grants waiting, in different programmes.
  await makeGrant('TwinYouth', {
    reference: `TWY-${M}`,
    charityNumber: charity(2),
    rp: rpYouth!.id,
    milestones: 1,
  })
  await makeGrant('TwinArts', {
    reference: `TWA-${M}`,
    charityNumber: charity(2),
    rp: rpArts!.id,
    milestones: 2,
  })
  // One charity whose only grant expects nothing more.
  await makeGrant('Done', {
    reference: `DONE-${M}`,
    charityNumber: charity(3),
    rp: rpYouth!.id,
    milestones: 1,
    answered: 1,
  })
}, 120_000)

afterAll(async () => {
  if (clientId) {
    await getDb().execute(sql`delete from audit_log where actor_user_id = ${actor.id}`)
    await teardownDemo(clientId)
    await getDb().delete(users).where(eq(users.id, actor.id))
  }
  if (otherClientId) await teardownDemo(otherClientId)
}, 120_000)

async function submitApplication(payload: Record<string, unknown>, forClient = clientId) {
  const id = await saveIngest({ clientId: forClient, payload })
  const result = await processIngest(id)
  const row = await getDb().query.applicationIngests.findFirst({
    where: eq(applicationIngests.id, id),
  })
  return { id, result, row: row! }
}

async function submitReport(payload: Record<string, unknown>, forClient = clientId) {
  const id = await saveReportIngest({ clientId: forClient, payload })
  const result = await processReportIngest(id)
  const row = await getDb().query.reportIngests.findFirst({ where: eq(reportIngests.id, id) })
  return { id, result, row: row! }
}

const applicationsWithRef = (ref: string) =>
  getDb().select().from(applications).where(eq(applications.externalApplicationId, ref))

// ─── Applications ────────────────────────────────────────────────────────────

describe('application pipeline', () => {
  const clean = (ref: string) => ({
    externalApplicationId: ref,
    programmeName: `Youth ${M}`,
    organisationName: `Clean Trust ${M}`,
    applicantEmail: 'grants@example.org',
  })

  it('promotes a clean submission, and one with no amount waits for it', async () => {
    const { result, row } = await submitApplication(clean(`APP-1-${M}`))
    expect(result).toMatchObject({ ok: true, status: 'complete' })
    const [app] = await applicationsWithRef(`APP-1-${M}`)
    expect(app).toBeDefined()
    expect(row.applicationId).toBe(app!.id)
    expect(app!.amountRequested).toBeNull()
    expect(app!.custodianScoreStatus).toBe('waiting')
  })

  it('absorbs an exact re-send, creating nothing and pointing at nothing', async () => {
    const first = await submitApplication(clean(`APP-2-${M}`))
    const again = await submitApplication(clean(`APP-2-${M}`))
    expect(again.result).toMatchObject({ ok: true, status: 'complete', applicationId: null })
    // Not the original's application: the admin app's Delete removes what a row points at.
    expect(again.row.applicationId).toBeNull()
    expect(again.row.note).toContain(first.id)
    expect(await applicationsWithRef(`APP-2-${M}`)).toHaveLength(1)
  })

  it('lets exactly one of two simultaneous copies through', async () => {
    // A retry racing its original: both rows saved, both processed at once. The earlier
    // (by created_at, then id) must win and the later must yield, whichever finishes first.
    const payload = clean(`APP-RACE-${M}`)
    const [a, b] = await Promise.all([
      saveIngest({ clientId, payload }),
      saveIngest({ clientId, payload }),
    ])
    await Promise.all([processIngest(a), processIngest(b)])
    expect(await applicationsWithRef(`APP-RACE-${M}`)).toHaveLength(1)
  })

  it('absorbs a re-send whose keys arrive in a different order', async () => {
    const payload = clean(`APP-3-${M}`)
    await submitApplication(payload)
    const reordered = Object.fromEntries(Object.entries(payload).reverse())
    const again = await submitApplication(reordered)
    expect(again.row.note).toMatch(/exact re-send/)
    expect(await applicationsWithRef(`APP-3-${M}`)).toHaveLength(1)
  })

  it('holds the same reference with different answers, and a reviewer cannot confirm it through', async () => {
    await submitApplication(clean(`APP-4-${M}`))
    const changed = await submitApplication({ ...clean(`APP-4-${M}`), applicantEmail: 'new@example.org' })
    expect(changed.row.status).toBe('needs_review')
    expect(changed.row.applicationId).toBeNull()

    const blockers = (await diagnoseIngests([changed.row])).get(changed.id) ?? []
    expect(blockers.map((b) => b.code)).toContain('reference_taken')

    const mapping = Object.fromEntries(Object.keys(clean('x')).map((k) => [k, k]))
    const resolved = await resolveIngest(
      changed.id,
      { mapping, values: {}, addToLookup: [] },
      'itest',
    )
    expect(resolved).toMatchObject({ ok: false, error: 'invalid' })
    expect(await applicationsWithRef(`APP-4-${M}`)).toHaveLength(1)
  })

  it('lands with unreadable optional values left off, rather than holding', async () => {
    const { result, row } = await submitApplication({
      ...clean(`APP-5-${M}`),
      applicantEmail: 'grants at example dot org',
      'How much are you asking for?': '£2,500-5,000 per year',
      bankSortCode: '20-00-00 (Barclays, Leeds branch) call before paying',
      organisationSummary: 'We run youth clubs.',
    })
    expect(result).toMatchObject({ ok: true, status: 'complete' })
    const [app] = await applicationsWithRef(`APP-5-${M}`)
    expect(app!.applicantEmail).toBeNull()
    expect(app!.amountRequested).toBeNull()
    expect(app!.bankSortCode).toBeNull()
    expect(app!.organisationSummary).toBe('We run youth clubs.')
    // Still indexed as answers to those fields, which is how the application screen
    // says "sent, but could not be read" rather than "never asked".
    const indexed = Object.fromEntries(
      (app!.submittedFields ?? []).map((f) => [f.label, f.canonical]),
    )
    expect(indexed['applicantEmail']).toBe('applicantEmail')
    expect(indexed['bankSortCode']).toBe('bankSortCode')
    expect(row.applicationId).toBe(app!.id)
  })

  it('still holds when a required field is missing', async () => {
    const { row, id } = await submitApplication({
      programmeName: `Youth ${M}`,
      organisationName: `No Ref Trust ${M}`,
    })
    expect(row.status).toBe('needs_review')
    const codes = ((await diagnoseIngests([row])).get(id) ?? []).map((b) => b.code)
    expect(codes).toContain('required_unmapped')
  })

  it('holds a programme nobody runs, and says which of theirs it nearly is', async () => {
    const { row, id } = await submitApplication({
      ...clean(`APP-6-${M}`),
      programmeName: `Yuoth ${M}`,
    })
    expect(row.status).toBe('needs_review')
    const blocker = ((await diagnoseIngests([row])).get(id) ?? []).find(
      (b) => b.code === 'programme_unknown',
    )
    expect(blocker?.fix).toContain(`Youth ${M}`)
  })

  it('reads a Typeform envelope into the same application a flat post makes', async () => {
    const envelope = {
      event_id: `evt-${M}`,
      event_type: 'form_response',
      form_response: {
        token: `tok-${M}`,
        submitted_at: '2026-09-29T10:00:00Z',
        hidden: { externalApplicationId: `APP-TF-${M}`, programmeName: `Youth ${M}` },
        definition: {
          title: 'Grant application',
          fields: [{ id: 'q1', title: 'Organisation name', type: 'short_text' }],
        },
        answers: [
          { type: 'text', text: `Typeform Trust ${M}`, field: { id: 'q1', type: 'short_text' } },
        ],
      },
    }
    const decoded = await parseSubmissionPayload(
      new Request('https://custodian.fund/api/webhooks/typeform/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      }),
    )
    expect(decoded.ok).toBe(true)
    const { result } = await submitApplication((decoded as { payload: Record<string, unknown> }).payload)
    expect(result).toMatchObject({ ok: true, status: 'complete' })
    const [app] = await applicationsWithRef(`APP-TF-${M}`)
    expect(app!.organisationName).toBe(`Typeform Trust ${M}`)
  })

  it('re-confirming never rewrites an application the foundation has edited', async () => {
    const { id } = await submitApplication(clean(`APP-7-${M}`))
    const [app] = await applicationsWithRef(`APP-7-${M}`)
    // The foundation corrected the email in Custodian.
    await getDb()
      .update(applications)
      .set({ applicantEmail: 'corrected@example.org' })
      .where(eq(applications.id, app!.id))
    await getDb().insert(applicationEdits).values({
      applicationId: app!.id,
      field: 'applicantEmail',
      previousValue: 'grants@example.org',
      newValue: 'corrected@example.org',
      method: 'typed',
      editedBy: actor.id,
    })

    const mapping = Object.fromEntries(Object.keys(clean('x')).map((k) => [k, k]))
    // Unchanged mapping: recorded, application untouched.
    const same = await resolveIngest(id, { mapping, values: {}, addToLookup: [] }, 'itest')
    expect(same).toMatchObject({ ok: true, updated: false })
    // A changed mapping (dropping the email) would overwrite their edit: refused.
    const { applicantEmail: _dropped, ...withoutEmail } = mapping
    const changed = await resolveIngest(
      id,
      { mapping: withoutEmail, values: {}, addToLookup: [] },
      'itest',
    )
    expect(changed).toMatchObject({ ok: false, error: 'locked' })
    const [after] = await applicationsWithRef(`APP-7-${M}`)
    expect(after!.applicantEmail).toBe('corrected@example.org')
  })
})

// ─── Reports ─────────────────────────────────────────────────────────────────

describe('report pipeline', () => {
  const tickedMilestones = async (awardId: string) =>
    (
      await getDb()
        .select({ id: reportSchedule.id })
        .from(reportSchedule)
        .where(and(eq(reportSchedule.awardId, awardId), sql`${reportSchedule.submittedDate} is not null`))
    ).map((r) => r.id)

  it('links on the exact reference, ticks the earliest open milestone, dated when it arrived', async () => {
    const { result, row } = await submitReport({
      externalApplicationId: `solo-${M}`.toUpperCase(),
      impactSummary: 'We reached 40 young people.',
    })
    expect(result).toMatchObject({ ok: true, status: 'complete' })
    const report = await getDb().query.reports.findFirst({ where: eq(reports.id, row.reportId!) })
    expect(report!.awardId).toBe(grants.Solo!.awardId)
    expect(report!.matchMethod).toBe('external_id')
    expect(report!.scheduleId).toBe(grants.Solo!.milestones[0])
    expect(report!.submittedAt.getTime()).toBe(row.createdAt.getTime())
    expect(report!.organisationName).toBe(`Solo ${M}`)
  })

  it('absorbs an exact re-send, so the next milestone is not ticked as well', async () => {
    const payload = {
      externalApplicationId: `SOLO-${M}`,
      impactSummary: 'A report sent twice.',
    }
    await submitReport(payload)
    const before = await tickedMilestones(grants.Solo!.awardId)
    const again = await submitReport(payload)
    expect(again.row.reportId).toBeNull()
    expect(again.row.note).toMatch(/exact re-send/)
    expect(await tickedMilestones(grants.Solo!.awardId)).toEqual(before)
  })

  it('links on the charity number when that charity has one grant waiting', async () => {
    const { row } = await submitReport({
      'Charity number': charity(1),
      impactSummary: 'No reference, but a registered number.',
    })
    const report = await getDb().query.reports.findFirst({ where: eq(reports.id, row.reportId!) })
    expect(report!.awardId).toBe(grants.Solo!.awardId)
    expect(report!.matchMethod).toBe('charity_number')
  })

  it('holds when the charity has two grants waiting and nothing chooses between them', async () => {
    const { row, id } = await submitReport({
      'Charity number': charity(2),
      impactSummary: 'Which grant is this?',
    })
    expect(row.status).toBe('needs_review')
    expect(row.reportId).toBeNull()
    const suggested = (row.matchCandidates ?? []).map((c) => c.awardId)
    expect(suggested).toEqual(
      expect.arrayContaining([grants.TwinYouth!.awardId, grants.TwinArts!.awardId]),
    )
    expect(id).toBeTruthy()
  })

  it('lets a named programme choose between two waiting grants', async () => {
    const { row } = await submitReport({
      'Charity number': charity(2),
      programmeName: `arts ${M}`,
      impactSummary: 'The arts one.',
    })
    const report = await getDb().query.reports.findFirst({ where: eq(reports.id, row.reportId!) })
    expect(report!.awardId).toBe(grants.TwinArts!.awardId)
  })

  it('holds rather than links a grant that expects nothing more', async () => {
    const { row } = await submitReport({
      'Charity number': charity(3),
      impactSummary: 'An extra report.',
    })
    expect(row.status).toBe('needs_review')
  })

  it("never links on another foundation's charity number", async () => {
    const { row } = await submitReport(
      { 'Charity number': charity(1), impactSummary: 'Wrong foundation.' },
      otherClientId,
    )
    expect(row.status).toBe('needs_review')
    expect(row.reportId).toBeNull()
  })

  it('lands an unreadable figure without one, and keeps their answer', async () => {
    const { row } = await submitReport({
      externalApplicationId: `TWY-${M}`,
      impactSummary: 'A busy term.',
      beneficiaryCount: 'about 60-70',
    })
    expect(row.status).toBe('complete')
    const report = await getDb().query.reports.findFirst({ where: eq(reports.id, row.reportId!) })
    expect(report!.beneficiaryCount).toBeNull()
    const asSent = (await reportsAsSent([report!])).get(report!.id)
    expect(asSent?.unreadFigure).toEqual({ question: 'beneficiaryCount', answer: 'about 60-70' })
  })

  it('moves between grants and back to the holding list, keeping milestones honest', async () => {
    const { row } = await submitReport({
      externalApplicationId: `TWA-${M}`,
      impactSummary: 'Attached to the wrong grant.',
    })
    const reportId = row.reportId!
    const arts = grants.TwinArts!
    const took = (await getDb().query.reports.findFirst({ where: eq(reports.id, reportId) }))!
      .scheduleId!
    expect(await tickedMilestones(arts.awardId)).toContain(took)

    // Move to the youth grant as an extra report: the arts milestone it took reopens,
    // and nothing on the youth grant is ticked by it.
    const youth = grants.TwinYouth!
    const youthTickedBefore = await tickedMilestones(youth.awardId)
    await moveReport({ reportId, awardId: youth.awardId, scheduleId: null, actor })
    expect(await tickedMilestones(arts.awardId)).not.toContain(took)
    expect(await tickedMilestones(youth.awardId)).toEqual(youthTickedBefore)

    // And send it back: the report goes, its submission waits for a grant again.
    await returnReport({ reportId, actor })
    const gone = await getDb().query.reports.findFirst({ where: eq(reports.id, reportId) })
    expect(gone).toBeUndefined()
    const ingest = await getDb().query.reportIngests.findFirst({
      where: eq(reportIngests.id, row.id),
    })
    expect(ingest).toMatchObject({ status: 'needs_review', reportId: null })
  })
})

// A fixture row the suite depends on, checked so a silent setup failure reads as one.
it('built its fixture', () => {
  expect(youthRp).not.toBe('')
  expect(Object.keys(grants)).toHaveLength(4)
})
