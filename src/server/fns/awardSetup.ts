import { badRequest, conflict, forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationVotes,
  applications,
  awardInstalments,
  awardLetters,
  awards,
  clientProfiles,
  clients,
  reportSchedule,
  roundProgrammes,
  users,
} from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { recordAudit } from '../audit'
import { assertClientAccess, intersectScope, visibleRoundProgrammeIds } from '../scope'
import { runInBackground } from '../background'
import { issueAwardLetter, resendStoredLetter } from '../awardLetter'
import { renderAwardLetter, type AwardLetterInput } from '../../lib/awardLetter'
import {
  AwardLetterSettingsSchema,
  CreateAwardsSchema,
  type AwardTerms,
} from '../../lib/validators/awardSetup'

// ─── The award-setup queue ──────────────────────────────────────────────────────

/**
 * The applications a board has approved and an admin has not yet turned into grants:
 * shortlisted, carrying a majority of trustee yes-votes, with no award yet.
 *
 * This is the same majority rule `createAwards` enforces server-side — surfaced as a
 * list so the set-up screen shows exactly what it is allowed to award, rather than
 * offering candidates the write path will reject.
 *
 * `shortlistedCount` rides along because the two Shortlist tabs are one control: the
 * set-up screen has to label the tab it is NOT on, and counting the round's shortlist a
 * second way is how the two numbers would come to disagree.
 */
export const listAwardCandidates = createServerFn({ method: 'GET' })
  .validator(z.object({ roundId: z.uuid().optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    let filterIds: string[] | undefined
    if (data.roundId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, data.roundId))
      filterIds = rows.map((r) => r.id)
    }

    const roundProgrammeIds = intersectScope(await visibleRoundProgrammeIds(user), filterIds)
    return awardCandidatesData(getDb(), roundProgrammeIds)
  })

/**
 * The Set up awards queue, as a plain function of (connection, tenant) — the same seam
 * Finance, Awards and Reports have, so everything below the auth check runs without a
 * session.
 *
 * Extracted so tenant isolation can be asserted on the rows this actually returns
 * (`src/server/tenancy.itest.ts`). `roundProgrammeIds` is already intersected with any
 * round filter by the caller; `undefined` is a superadmin, unrestricted.
 */
export async function awardCandidatesData(
  db: ReturnType<typeof getDb>,
  roundProgrammeIds: string[] | undefined,
) {
  {
    const empty = { items: [] as AwardCandidate[], shortlistedCount: 0 }
    // An empty (non-null) scope is a caller who can see nothing; `inArray(x, [])` is a
    // SQL error, so it never reaches the query.
    if (roundProgrammeIds !== undefined && roundProgrammeIds.length === 0) return empty

    const items = await db.query.applications.findMany({
      where: (a, { and, eq }) =>
        and(
          eq(a.status, 'shortlisted'),
          roundProgrammeIds ? inArray(a.roundProgrammeId, roundProgrammeIds) : undefined,
        ),
      with: { roundProgramme: { with: { programme: true, round: true } } },
      orderBy: (a, { desc }) => [desc(a.amountRequested)],
    })
    if (items.length === 0) return empty

    const appIds = items.map((a) => a.id)
    const clientIds = [...new Set(items.map((a) => a.roundProgramme.programme.clientId))]
    const [yesRows, trusteeRows] = await Promise.all([
      db
        .select({ applicationId: applicationVotes.applicationId, yes: count() })
        .from(applicationVotes)
        .where(
          and(inArray(applicationVotes.applicationId, appIds), eq(applicationVotes.vote, 'yes')),
        )
        .groupBy(applicationVotes.applicationId),
      db
        .select({ clientId: users.clientId, trustees: count() })
        .from(users)
        .where(and(eq(users.role, 'trustee'), inArray(users.clientId, clientIds)))
        .groupBy(users.clientId),
    ])
    const yesByApp = new Map(yesRows.map((r) => [r.applicationId, r.yes]))
    const trusteesByClient = new Map(trusteeRows.map((r) => [r.clientId, r.trustees]))

    const candidates = items
      .filter((a) => {
        const trustees = trusteesByClient.get(a.roundProgramme.programme.clientId) ?? 0
        return trustees > 0 && (yesByApp.get(a.id) ?? 0) * 2 > trustees
      })
      .map((a) => ({
        id: a.id,
        organisationName: a.organisationName,
        applicantEmail: a.applicantEmail,
        amountRequested: parseFloat(a.amountRequested),
        externalApplicationId: a.externalApplicationId,
        deliveryArea: a.deliveryRegion ?? a.deliveryArea,
        charityNumber: a.charityNumber,
        companyNumber: a.companyNumber,
        custodianScore: a.custodianScore,
        custodianScoreStatus: a.custodianScoreStatus,
        // Pre-fills the purpose on the set-up screen. Sent as the application's own
        // value, not written to the award here: what the admin does with it — accept,
        // reword, replace — is the award's copy, and the application keeps its own.
        grantPurpose: a.grantPurpose,
        programmeId: a.roundProgramme.programmeId,
        programmeName: a.roundProgramme.programme.name,
        tags: ((a.roundProgramme.programme.tags as string[] | null) ?? []) as string[],
        roundName: a.roundProgramme.round.name,
        roundId: a.roundProgramme.roundId,
        grantDurationYears: a.roundProgramme.grantDurationYears,
        yesVotes: yesByApp.get(a.id) ?? 0,
        trusteeCount: trusteesByClient.get(a.roundProgramme.programme.clientId) ?? 0,
      }))

    return { items: candidates, shortlistedCount: items.length }
  }
}

/** One row of the award-setup queue. Named so the empty payload can be typed. */
export type AwardCandidate = {
  id: string
  organisationName: string
  applicantEmail: string | null
  amountRequested: number
  externalApplicationId: string | null
  deliveryArea: string | null
  charityNumber: string | null
  companyNumber: string | null
  custodianScore: number | null
  custodianScoreStatus: string
  grantPurpose: string | null
  programmeId: string
  programmeName: string
  tags: string[]
  roundName: string
  roundId: string
  grantDurationYears: number | null
  yesVotes: number
  trusteeCount: number
}

// ─── Letter settings ────────────────────────────────────────────────────────────

/**
 * The foundation's award-letter configuration. Nulls mean "use the built-in default" —
 * resolved in the pure renderer, not here, so the settings screen can show which values
 * are overridden and which are inherited.
 */
export const getAwardLetterSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return null
  const [profile, client] = await Promise.all([
    getDb().query.clientProfiles.findFirst({
      where: (p, { eq }) => eq(p.clientId, user.clientId!),
    }),
    getDb().query.clients.findFirst({ where: (c, { eq }) => eq(c.id, user.clientId!) }),
  ])
  return {
    foundationName: client?.name ?? '',
    template: profile?.awardLetterTemplate ?? null,
    conditions: profile?.awardLetterConditions ?? null,
    signatory: profile?.awardLetterSignatory ?? null,
    senderName: profile?.awardLetterSenderName ?? null,
    replyTo: profile?.awardLetterReplyTo ?? null,
  }
})

export const updateAwardLetterSettings = createServerFn({ method: 'POST' })
  .validator(AwardLetterSettingsSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')

    // Only write the keys the caller actually sent, so saving the signatory never
    // clobbers the template (same rule as `upsertClientProfile`).
    const fields: Partial<typeof clientProfiles.$inferInsert> = {}
    if (data.template !== undefined) fields.awardLetterTemplate = data.template
    if (data.conditions !== undefined) fields.awardLetterConditions = data.conditions
    if (data.signatory !== undefined) fields.awardLetterSignatory = data.signatory || null
    if (data.senderName !== undefined) fields.awardLetterSenderName = data.senderName || null
    if (data.replyTo !== undefined) fields.awardLetterReplyTo = data.replyTo || null

    const [profile] = await getDb()
      .insert(clientProfiles)
      .values({ clientId: user.clientId, ...fields })
      .onConflictDoUpdate({
        target: clientProfiles.clientId,
        set: { ...fields, updatedAt: new Date() },
      })
      .returning()
    return profile!
  })

// ─── Creating awards ────────────────────────────────────────────────────────────

/** The client-level facts every letter in a batch shares. */
async function loadLetterContext(clientId: string) {
  const [client, profile] = await Promise.all([
    getDb().query.clients.findFirst({ where: (c, { eq }) => eq(c.id, clientId) }),
    getDb().query.clientProfiles.findFirst({ where: (p, { eq }) => eq(p.clientId, clientId) }),
  ])
  return {
    foundationName: client?.name ?? 'the Foundation',
    settings: {
      template: profile?.awardLetterTemplate ?? null,
      conditions: profile?.awardLetterConditions ?? null,
      signatory: profile?.awardLetterSignatory ?? null,
    },
    senderName: profile?.awardLetterSenderName ?? client?.name ?? null,
    replyTo: profile?.awardLetterReplyTo ?? null,
  }
}

type LetterContext = Awaited<ReturnType<typeof loadLetterContext>>

/** Build the letter for one grant from the facts about to be written. */
function letterForGrant({
  ctx,
  terms,
  application,
  amountAwarded,
  purpose,
  specialCondition,
  schedule,
}: {
  ctx: LetterContext
  terms: AwardTerms
  application: {
    organisationName: string
    externalApplicationId: string | null
    programmeName: string | null
    roundName: string | null
  }
  amountAwarded: number
  purpose: string | null
  specialCondition: string | null
  schedule: Array<{ amount: number; date: string | null }>
}) {
  const input: AwardLetterInput = {
    organisationName: application.organisationName,
    foundationName: ctx.foundationName,
    amountAwarded,
    purpose,
    startDate: terms.startDate,
    programmeName: application.programmeName,
    roundName: application.roundName,
    reference: application.externalApplicationId,
    instalments: schedule.map((s) => ({ amount: s.amount, dueDate: s.date })),
    reporting: terms.reporting,
    signatory: ctx.settings.signatory,
  }
  return renderAwardLetter({
    input,
    // Turning the standard conditions off leaves only whatever is specific to this
    // grant — an empty list is a legitimate outcome, not a missing value.
    settings: terms.useStandardConditions ? ctx.settings : { ...ctx.settings, conditions: [] },
    specialCondition,
  })
}

/**
 * Turn board-approved applications into live grants, in one batch.
 *
 * Each grant is written atomically (`db.batch` — neon-http has no interactive
 * transactions) and INDEPENDENTLY: one application failing its majority check or having
 * been awarded already must not roll back the five that succeeded, because an admin
 * would then have no way to tell which of them to redo. The response reports per-grant
 * outcomes and the screen shows them.
 *
 * Letters are rendered synchronously — the admin approved a specific preview, and the
 * bytes are stored with the award — but SENT in the background, so a slow mail provider
 * doesn't hold up the response for a commitment that is already made.
 */
export const createAwards = createServerFn({ method: 'POST' })
  .validator(CreateAwardsSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()

    const applicationIds = data.grants.map((g) => g.applicationId)
    if (new Set(applicationIds).size !== applicationIds.length) {
      throw badRequest('The same application appears twice in this batch')
    }

    const rows = await db.query.applications.findMany({
      where: (a, { inArray }) => inArray(a.id, applicationIds),
      with: {
        roundProgramme: { with: { programme: true, round: true } },
        award: { columns: { id: true } },
      },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))

    // Every application in a batch must belong to one client — the letter context, the
    // trustee roster and the tenancy check are all per-client, and a mixed batch could
    // only arise from a crafted request.
    const clientIds = [...new Set(rows.map((r) => r.roundProgramme.programme.clientId))]
    if (clientIds.length > 1) throw badRequest('Awards must all belong to one organisation')
    const clientId = clientIds[0]
    if (!clientId) throw notFoundError()
    assertClientAccess(user, clientId)

    const [trusteeRows, yesRows] = await Promise.all([
      db
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId))),
      db
        .select({ applicationId: applicationVotes.applicationId, yes: count() })
        .from(applicationVotes)
        .where(
          and(
            inArray(applicationVotes.applicationId, applicationIds),
            eq(applicationVotes.vote, 'yes'),
          ),
        )
        .groupBy(applicationVotes.applicationId),
    ])
    const trusteeCount = trusteeRows[0]?.count ?? 0
    const yesByApp = new Map(yesRows.map((r) => [r.applicationId, r.yes]))

    const ctx = await loadLetterContext(clientId)
    const decisionAt = new Date()

    const results: Array<{
      applicationId: string
      organisationName: string
      awardId?: string
      error?: string
    }> = []
    // Collected and fired after the loop so the response isn't waiting on mail.
    const pendingLetters: Array<Parameters<typeof issueAwardLetter>[0]> = []

    for (const grant of data.grants) {
      const app = byId.get(grant.applicationId)
      if (!app) {
        results.push({
          applicationId: grant.applicationId,
          organisationName: 'Unknown application',
          error: 'Not found',
        })
        continue
      }
      const name = app.organisationName

      if (app.status !== 'shortlisted') {
        results.push({
          applicationId: grant.applicationId,
          organisationName: name,
          error: 'No longer shortlisted — it may already have been awarded or declined.',
        })
        continue
      }
      if (app.award) {
        results.push({
          applicationId: grant.applicationId,
          organisationName: name,
          error: 'This application already has an award.',
        })
        continue
      }
      if (trusteeCount === 0 || (yesByApp.get(grant.applicationId) ?? 0) * 2 <= trusteeCount) {
        results.push({
          applicationId: grant.applicationId,
          organisationName: name,
          error: 'A majority of trustees must vote in favour before an award can be generated.',
        })
        continue
      }

      const allocated = grant.schedule.reduce((s, r) => s + r.amount, 0)
      // Guard here as well as in the UI: a schedule that doesn't sum to the award would
      // silently under- or over-pay the grantee, and the letter would state a total the
      // instalments never reach.
      if (Math.abs(allocated - grant.amountAwarded) > 0.005) {
        results.push({
          applicationId: grant.applicationId,
          organisationName: name,
          error: 'The payment schedule does not add up to the amount awarded.',
        })
        continue
      }

      const letter = letterForGrant({
        ctx,
        terms: data.terms,
        application: {
          organisationName: name,
          externalApplicationId: app.externalApplicationId,
          programmeName: app.roundProgramme.programme.name,
          roundName: app.roundProgramme.round.name,
        },
        amountAwarded: grant.amountAwarded,
        purpose: grant.purpose,
        specialCondition: grant.specialCondition,
        schedule: grant.schedule,
      })

      const awardId = crypto.randomUUID()
      const insertAward = db.insert(awards).values({
        id: awardId,
        applicationId: grant.applicationId,
        clientId,
        amountAwarded: grant.amountAwarded.toString(),
        status: 'active' as const,
        purpose: grant.purpose,
        specialCondition: grant.specialCondition,
        startDate: data.terms.startDate,
        decisionAt,
      })
      const insertInstalments = db.insert(awardInstalments).values(
        grant.schedule.map((s) => ({
          awardId,
          instalmentNo: s.instalment,
          amount: s.amount.toString(),
          dueDate: s.date,
        })),
      )
      const flipStatus = db
        .update(applications)
        .set({ status: 'awarded' as const, decisionAt })
        .where(eq(applications.id, grant.applicationId))

      try {
        // One batch per grant: neon-http has no interactive transactions, but a batch
        // runs atomically, so a grant can never end up with an award row and no
        // schedule (or vice versa). The batch is spelled out twice rather than built
        // from a dynamic array because drizzle types `batch` on its tuple arity.
        if (data.terms.reporting.length > 0) {
          await db.batch([
            insertAward,
            insertInstalments,
            db.insert(reportSchedule).values(
              data.terms.reporting.map((r) => ({
                awardId,
                label: r.label,
                dueDate: r.dueDate,
              })),
            ),
            flipStatus,
          ])
        } else {
          await db.batch([insertAward, insertInstalments, flipStatus])
        }
      } catch (err) {
        console.error(`[createAwards] failed to write award for ${grant.applicationId}:`, err)
        results.push({
          applicationId: grant.applicationId,
          organisationName: name,
          error: 'Could not be saved. Nothing was changed for this application.',
        })
        continue
      }

      results.push({ applicationId: grant.applicationId, organisationName: name, awardId })
      pendingLetters.push({
        awardId,
        clientId,
        letter,
        delivery: {
          recipientEmail: app.applicantEmail,
          replyTo: ctx.replyTo,
          senderName: ctx.senderName,
        },
      })
      await recordAudit({
        actorUserId: user.id,
        action: 'application_awarded',
        applicationId: grant.applicationId,
        clientId,
        metadata: { amountAwarded: grant.amountAwarded, awardId },
      })
    }

    if (pendingLetters.length > 0) {
      runInBackground('award letters', async () => {
        for (const pending of pendingLetters) await issueAwardLetter(pending)
      })
    }

    const created = results.filter((r) => r.awardId)
    return {
      created: created.length,
      failed: results.filter((r) => r.error).length,
      totalCommitted: data.grants
        .filter((g) => created.some((c) => c.applicationId === g.applicationId))
        .reduce((s, g) => s + g.amountAwarded, 0),
      results,
    }
  })

// ─── Reading and resending a letter ─────────────────────────────────────────────

export const getAwardLetter = createServerFn({ method: 'GET' })
  .validator(z.object({ awardId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const letter = await getDb().query.awardLetters.findFirst({
      where: (l, { eq }) => eq(l.awardId, data.awardId),
    })
    if (!letter) return null
    assertClientAccess(user, letter.clientId)
    return {
      id: letter.id,
      subject: letter.subject,
      bodyText: letter.bodyText,
      conditions: letter.conditions,
      status: letter.status,
      recipientEmail: letter.recipientEmail,
      replyTo: letter.replyTo,
      failureReason: letter.failureReason,
      sentAt: letter.sentAt?.toISOString() ?? null,
    }
  })

/**
 * Send a stored letter again — the recovery path for a `failed` letter, and the way to
 * issue one that stayed `draft` because the application had no contact email.
 *
 * Runs inline rather than in the background: this is an explicit button press and the
 * admin needs to know whether it worked.
 */
export const resendAwardLetter = createServerFn({ method: 'POST' })
  .validator(z.object({ awardId: z.uuid(), recipientEmail: z.email().max(255).optional() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const letter = await getDb().query.awardLetters.findFirst({
      where: (l, { eq }) => eq(l.awardId, data.awardId),
    })
    if (!letter) throw conflict('No letter has been issued for this award')
    assertClientAccess(user, letter.clientId)

    if (data.recipientEmail && data.recipientEmail !== letter.recipientEmail) {
      await getDb()
        .update(awardLetters)
        .set({ recipientEmail: data.recipientEmail, updatedAt: new Date() })
        .where(eq(awardLetters.id, letter.id))
    }

    const result = await resendStoredLetter(letter.id)
    if (!result.ok) throw conflict(result.error ?? 'The letter could not be sent')

    // An outbound communication to a third party, sometimes to a different address
    // than the original — logged only once the send actually succeeded.
    const award = await getDb().query.awards.findFirst({
      where: eq(awards.id, data.awardId),
      columns: { applicationId: true },
    })
    await recordAudit({
      actorUserId: user.id,
      action: 'award_letter_resent',
      ...(award ? { applicationId: award.applicationId } : {}),
      clientId: letter.clientId,
      metadata: { recipientEmail: data.recipientEmail ?? letter.recipientEmail },
    })
    return { ok: true as const }
  })
