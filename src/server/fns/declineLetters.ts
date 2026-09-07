// ─── Telling the unsuccessful applicants ────────────────────────────────────────
//
// The last thing that happens to a funding round. An admin declines applications as the
// board decides them — that is `updateApplicationStatus`, and it is reversible — and
// then, once the round is closed and every decision is made, tells the people who did
// not get the money. This module is the second half only. It NEVER changes an
// application's status: the button sends letters to organisations already declined, so
// that an irreversible email to a third party is never the same click as a bulk status
// change, and an application still `for_review` is reported as an unfinished decision
// rather than silently converted into a rejection.
//
// The batch is built and sent in three deliberately separate steps:
//
//   1. `getDeclineBatch` — who would be emailed, who already has been, who cannot be,
//      and what is still undecided. Read-only; the dialog renders the letters from it.
//   2. `sendDeclineLetters` — render every letter and commit them in ONE `db.batch`.
//      No email is sent here.
//   3. the queue — one message per stored letter, each sent by `sendStoredDeclineLetter`.
//
// The split is what makes the feature safe to press twice: the unique index on
// `decline_letters.application_id` means step 2 can only ever create one letter per
// applicant, and step 3 re-sends stored bytes rather than re-rendering them.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applications,
  clientProfiles,
  clients,
  declineLetters,
  programmes,
  roundProgrammes,
  rounds,
} from '../../../drizzle/schema'
import { requireRole } from '../session'
import { recordAudit } from '../audit'
import { assertClientAccess, intersectScope, visibleRoundProgrammeIds } from '../scope'
import { enqueueMany } from '../pipelineQueue'
import { sendStoredDeclineLetter } from '../declineLetter'
import { forbidden, notFoundError } from '../../lib/errors'
import { getRoundStatus } from '../../lib/roundStatus'
import {
  normaliseEmail,
  planDeclineBatch,
  renderDeclineLetter,
  type AddressRecord,
  type DeclineLetterInput,
} from '../../lib/declineLetter'
import {
  DeclineLetterSettingsSchema,
  SendDeclineLettersSchema,
} from '../../lib/validators/declineLetter'

// ─── Letter settings ────────────────────────────────────────────────────────────

/**
 * The foundation's decline-letter configuration.
 *
 * `awardSignatory` rides along because it is this letter's fallback signatory (see
 * `resolveDeclineSettings`) — the settings screen shows it as the inherited value, so a
 * blank field reads as "signed the same way as your award letters" rather than as
 * "unsigned". `senderName` and `replyTo` are the shared pair off the award letter: how
 * the foundation appears in email is a fact about the foundation, not about one letter.
 */
export const getDeclineLetterSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireRole('admin', 'superadmin')
  if (!user.clientId) return null
  const [profile, client] = await Promise.all([
    getDb().query.clientProfiles.findFirst({
      where: (p, { eq }) => eq(p.clientId, user.clientId!),
    }),
    getDb().query.clients.findFirst({ where: (c, { eq }) => eq(c.id, user.clientId!) }),
  ])
  return {
    foundationName: client?.name ?? '',
    template: profile?.declineLetterTemplate ?? null,
    signatory: profile?.declineLetterSignatory ?? null,
    awardSignatory: profile?.awardLetterSignatory ?? null,
    senderName: profile?.awardLetterSenderName ?? null,
    replyTo: profile?.awardLetterReplyTo ?? null,
  }
})

export const updateDeclineLetterSettings = createServerFn({ method: 'POST' })
  .validator(DeclineLetterSettingsSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')

    // Only the keys the caller actually sent, so saving the signatory never clobbers
    // the template (the same rule `updateAwardLetterSettings` follows).
    const fields: Partial<typeof clientProfiles.$inferInsert> = {}
    if (data.template !== undefined) fields.declineLetterTemplate = data.template
    if (data.signatory !== undefined) fields.declineLetterSignatory = data.signatory || null

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

// ─── The batch ──────────────────────────────────────────────────────────────────

/** One organisation in the batch, and everything the dialog needs to letter it. */
export type DeclineRecipient = {
  applicationId: string
  organisationName: string
  applicantEmail: string | null
  reference: string | null
  programmeName: string | null
  amountRequested: number | null
  /** Set once a letter exists for this application — the reason it is not re-sent. */
  notifiedAt: string | null
  /** A letter that exists but never reached anybody, and why. */
  letterStatus: 'draft' | 'sent' | 'failed' | null
  failureReason: string | null
}

/** The client-level facts every letter in a batch shares. */
async function loadDeclineContext(clientId: string) {
  const [client, profile] = await Promise.all([
    getDb().query.clients.findFirst({ where: (c, { eq }) => eq(c.id, clientId) }),
    getDb().query.clientProfiles.findFirst({ where: (p, { eq }) => eq(p.clientId, clientId) }),
  ])
  return {
    foundationName: client?.name ?? 'the Foundation',
    settings: {
      template: profile?.declineLetterTemplate ?? null,
      signatory: profile?.declineLetterSignatory ?? null,
    },
    awardSignatory: profile?.awardLetterSignatory ?? null,
    senderName: profile?.awardLetterSenderName ?? client?.name ?? null,
    replyTo: profile?.awardLetterReplyTo ?? null,
  }
}

/**
 * Resolve a round the caller may act on, and the round-programme ids inside their scope.
 *
 * The round's own `clientId` is checked AND the round-programme set is intersected with
 * the caller's visible scope. Both, not either: the first stops a crafted `roundId` from
 * another foundation, the second is the tenancy rule every list in the app obeys, and a
 * write that emails third parties is the last place to start trusting one of them alone.
 */
async function scopedRound(
  user: { id: string; role: string; clientId: string | null },
  roundId: string,
) {
  const round = await getDb().query.rounds.findFirst({ where: (r, { eq }) => eq(r.id, roundId) })
  if (!round) throw notFoundError()
  assertClientAccess(user, round.clientId)

  const rows = await getDb()
    .select({ id: roundProgrammes.id })
    .from(roundProgrammes)
    .where(eq(roundProgrammes.roundId, roundId))
  const scope = intersectScope(
    await visibleRoundProgrammeIds(user),
    rows.map((r) => r.id),
  )

  return { round, roundProgrammeIds: scope ?? rows.map((r) => r.id) }
}

/**
 * Every decline letter this foundation has already written to one of these addresses.
 *
 * Scoped to the addresses actually in front of us rather than reading the whole
 * history: a foundation that has run ten rounds has thousands of these, and the
 * question is only ever about the handful of people about to be emailed.
 *
 * `sent` and `draft` only. A `failed` letter reached nobody, so it must not bar the
 * address forever — see `planDeclineBatch`.
 */
async function addressesAlreadyWritten(
  clientId: string,
  emails: string[],
): Promise<AddressRecord[]> {
  if (emails.length === 0) return []
  const rows = await getDb()
    .select({
      email: declineLetters.recipientEmail,
      at: declineLetters.sentAt,
      roundName: rounds.name,
    })
    .from(declineLetters)
    .innerJoin(applications, eq(declineLetters.applicationId, applications.id))
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .innerJoin(rounds, eq(roundProgrammes.roundId, rounds.id))
    .where(
      and(
        eq(declineLetters.clientId, clientId),
        isNotNull(declineLetters.recipientEmail),
        inArray(declineLetters.status, ['sent', 'draft']),
        inArray(sql`lower(${declineLetters.recipientEmail})`, emails),
      ),
    )
  return rows.map((r) => ({
    email: r.email!,
    at: r.at ? r.at.toISOString() : null,
    roundName: r.roundName,
  }))
}

/**
 * Who the decline letters would go to, and what else is true about the round.
 *
 * Returns the already-notified alongside the still-to-notify rather than filtering them
 * out. "12 to email, 30 already told" is the sentence that stops an admin wondering
 * whether the button worked last time — and the pair also explains the count when a
 * second press finds nothing left to do.
 *
 * `stillInReview` is the warning the whole dialog is built around: applications with no
 * decision are NOT in the batch and never will be until somebody decides them, and a
 * round closed with three of them left is a round where three charities are waiting on
 * a letter that this button will never send.
 */
export const getDeclineBatch = createServerFn({ method: 'GET' })
  .validator(z.object({ roundId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    const { round, roundProgrammeIds } = await scopedRound(user, data.roundId)

    const empty = {
      roundName: round.name,
      roundClosed: getRoundStatus(round) === 'closed',
      recipients: [] as DeclineRecipient[],
      // Decline letters this foundation has already written to one of these addresses,
      // through any application. Returned rather than applied here so the dialog and
      // `sendDeclineLetters` reach their verdict through the SAME pure rule
      // (`planDeclineBatch`) instead of two implementations of "who is left".
      previouslyWritten: [] as AddressRecord[],
      stillInReview: 0,
      settings: null as Awaited<ReturnType<typeof loadDeclineContext>> | null,
    }
    if (roundProgrammeIds.length === 0) return empty

    const [rows, reviewRows, context] = await Promise.all([
      getDb()
        .select({
          applicationId: applications.id,
          organisationName: applications.organisationName,
          applicantEmail: applications.applicantEmail,
          reference: applications.externalApplicationId,
          programmeName: programmes.name,
          amountRequested: applications.amountRequested,
          notifiedAt: declineLetters.sentAt,
          letterStatus: declineLetters.status,
          failureReason: declineLetters.failureReason,
        })
        .from(applications)
        .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
        .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
        .leftJoin(declineLetters, eq(declineLetters.applicationId, applications.id))
        .where(
          and(
            inArray(applications.roundProgrammeId, roundProgrammeIds),
            eq(applications.status, 'declined'),
          ),
        )
        .orderBy(applications.organisationName),
      getDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(applications)
        .where(
          and(
            inArray(applications.roundProgrammeId, roundProgrammeIds),
            eq(applications.status, 'for_review'),
          ),
        ),
      loadDeclineContext(round.clientId),
    ])

    const emails = [
      ...new Set(
        rows.filter((r) => r.applicantEmail).map((r) => normaliseEmail(r.applicantEmail!)),
      ),
    ]

    return {
      ...empty,
      previouslyWritten: await addressesAlreadyWritten(round.clientId, emails),
      recipients: rows.map((r) => ({
        applicationId: r.applicationId,
        organisationName: r.organisationName,
        applicantEmail: r.applicantEmail,
        reference: r.reference,
        programmeName: r.programmeName,
        amountRequested: r.amountRequested ? parseFloat(r.amountRequested) : null,
        notifiedAt: r.notifiedAt ? r.notifiedAt.toISOString() : null,
        letterStatus: r.letterStatus ?? null,
        failureReason: r.failureReason ?? null,
      })),
      stillInReview: reviewRows[0]?.n ?? 0,
      settings: context,
    }
  })

// ─── Sending ────────────────────────────────────────────────────────────────────

/**
 * Render and store a letter for each unsuccessful applicant, then queue the sends.
 *
 * The round must be CLOSED. The button only appears on a closed round, but the check
 * lives here as well, because this is the boundary: a round still taking applications
 * is one where somebody could still be declined by mistake, and the whole point of
 * waiting for the close is that a decline letter cannot be taken back.
 *
 * Every letter in the batch is committed in one `db.batch` (neon-http has no
 * interactive transactions). That is the opposite of `createAwards`, which writes each
 * grant independently — and deliberately so. There, one failure must not roll back five
 * good grants, because each is a separate commitment an admin can redo on its own.
 * Here the rows are all the same act, they are cheap and identical, and a half-written
 * batch would leave an admin unable to tell which applicants are queued for a letter
 * and which are still waiting on one.
 *
 * Applicants with no contact email get a stored letter at `draft` and no queue message.
 * The document exists to send the moment somebody supplies an address, and the count
 * comes back so the dialog can say who was left out rather than quietly reporting a
 * smaller number than the admin approved.
 */
export const sendDeclineLetters = createServerFn({ method: 'POST' })
  .validator(SendDeclineLettersSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    const { round, roundProgrammeIds } = await scopedRound(user, data.roundId)

    if (getRoundStatus(round) !== 'closed') {
      throw forbidden(
        'This round is still open. Close it before telling applicants they were unsuccessful.',
      )
    }
    if (roundProgrammeIds.length === 0) return { sent: 0, withoutEmail: 0, skipped: 0 }

    // The eligible set is re-derived here rather than taken from the request: declined,
    // in this round, in the caller's scope, and with no letter already on file. The
    // posted ids only narrow it (an admin may have unticked somebody), and the left
    // join is what makes a second press a no-op instead of a second letter.
    const eligible = await getDb()
      .select({
        applicationId: applications.id,
        organisationName: applications.organisationName,
        applicantEmail: applications.applicantEmail,
        reference: applications.externalApplicationId,
        programmeName: programmes.name,
        amountRequested: applications.amountRequested,
        existingLetterId: declineLetters.id,
      })
      .from(applications)
      .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .leftJoin(declineLetters, eq(declineLetters.applicationId, applications.id))
      .where(
        and(
          inArray(applications.roundProgrammeId, roundProgrammeIds),
          eq(applications.status, 'declined'),
          inArray(applications.id, data.applicationIds),
        ),
      )

    // The same rule the dialog showed, applied again on the authoritative side. An
    // application whose own letter exists is skipped; so is one whose ADDRESS has had a
    // letter through any other application, and so is the second of two applications in
    // this batch sharing one mailbox. Nobody is written to twice, ever.
    const emails = [
      ...new Set(
        eligible.filter((r) => r.applicantEmail).map((r) => normaliseEmail(r.applicantEmail!)),
      ),
    ]
    const plan = planDeclineBatch({
      candidates: eligible.map((r) => ({
        ...r,
        letterStatus: r.existingLetterId ? ('sent' as const) : null,
      })),
      previouslyWritten: await addressesAlreadyWritten(round.clientId, emails),
    })

    const toWrite = plan.toNotify
    const skipped =
      plan.alreadyNotified.length + plan.addressAlreadyWritten.length + plan.duplicateInBatch.length
    if (toWrite.length === 0) {
      return { sent: 0, withoutEmail: plan.unreachable.length, skipped }
    }

    const ctx = await loadDeclineContext(round.clientId)
    const issuedAt = new Date()

    // Written for the reachable AND the unreachable: an applicant with no address still
    // gets the document, at `draft`, so it exists to send the moment somebody adds one.
    const values = [...toWrite, ...plan.unreachable].map((r) => {
      const input: DeclineLetterInput = {
        organisationName: r.organisationName,
        foundationName: ctx.foundationName,
        programmeName: r.programmeName,
        roundName: round.name,
        reference: r.reference,
        amountRequested: r.amountRequested ? parseFloat(r.amountRequested) : null,
        signatory: null,
        issuedAt,
      }
      const letter = renderDeclineLetter({
        input,
        settings: ctx.settings,
        awardSignatory: ctx.awardSignatory,
      })
      return {
        applicationId: r.applicationId,
        clientId: round.clientId,
        subject: letter.subject,
        bodyText: letter.bodyText,
        bodyHtml: letter.bodyHtml,
        // Snapshotted with the body, for the same reason: the foundation's reply-to may
        // change, and this row is the record of what was actually sent.
        recipientEmail: r.applicantEmail,
        replyTo: ctx.replyTo,
        senderName: ctx.senderName,
        status: 'draft' as const,
        failureReason: r.applicantEmail
          ? null
          : 'No contact email on the application — add one, then send again.',
      }
    })

    // `onConflictDoNothing` on top of the left join above: the filter is what makes the
    // common case right, the constraint is what makes a race right. Two admins pressing
    // the button at the same moment must produce one letter each, not two.
    const written = await getDb()
      .insert(declineLetters)
      .values(values)
      .onConflictDoNothing({ target: declineLetters.applicationId })
      .returning({ id: declineLetters.id, recipientEmail: declineLetters.recipientEmail })

    const sendable = written.filter((w) => w.recipientEmail)
    await enqueueMany(
      sendable.map((w) => ({ kind: 'decline_letter' as const, letterId: w.id })),
      (message) =>
        message.kind === 'decline_letter'
          ? sendStoredDeclineLetter(message.letterId)
          : Promise.resolve(),
    )

    const withoutEmail = written.length - sendable.length
    await recordAudit({
      actorUserId: user.id,
      clientId: round.clientId,
      action: 'decline_letters_sent',
      metadata: { roundName: round.name, count: sendable.length, noEmail: withoutEmail },
    })

    return { sent: sendable.length, withoutEmail, skipped }
  })
