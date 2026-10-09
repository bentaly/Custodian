// ─── The letters an expression of interest leads to ─────────────────────────────
//
// Settings for both letters (Settings → Letters → Expressions of interest), and the
// decline letters' batch. The batch is `fns/declineLetters.ts` for the stage before an
// application, and keeps its three steps apart for the same reason:
//
//   1. `getEoiDeclineBatch` — who would be written to, who already has been, who
//      cannot be. Read-only; the dialog renders the letters from it.
//   2. `sendEoiDeclineLetters` — render every letter and commit them in ONE insert.
//   3. the queue — one `eoi_decline_letter` message per stored letter.
//
// Scoped to ONE PROGRAMME, because that is how the EOI list is organised: the batch is
// the declined EOIs on screen when the button is pressed, never anybody else's. Declining
// an EOI (`decideEoi`) still emails nobody; this is the only path that does.
//
// Who is written to is `planDeclineBatch`, the decline letters' own rule, so nobody is
// told twice: one letter per EOI (the unique index), and one per ADDRESS across every
// EOI decline this foundation has sent. Application decline letters are a different
// letter about a different stage and do not bar an address here.
//
// Behind the `sourcing` flag, and admin-only, like every write in `fns/eois.ts`.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { clientProfiles, eoiDeclineLetters, eois, programmes } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { requireFeature } from '../features'
import { assertClientAccess } from '../scope'
import { enqueueMany } from '../pipelineQueue'
import { sendStoredEoiDeclineLetter } from '../eoiDeclineLetter'
import { forbidden, notFoundError } from '../../lib/errors'
import { normaliseEmail, planDeclineBatch, type AddressRecord } from '../../lib/declineLetter'
import { renderEoiDecline } from '../../lib/eoiLetters'

// ─── Settings ─────────────────────────────────────────────────────────────────

/** Both templates, plus what the preview needs to sign and address them as sent. */
export async function loadEoiLetterContext(clientId: string) {
  const [client, profile] = await Promise.all([
    getDb().query.clients.findFirst({ where: (c, { eq }) => eq(c.id, clientId) }),
    getDb().query.clientProfiles.findFirst({ where: (p, { eq }) => eq(p.clientId, clientId) }),
  ])
  return {
    foundationName: client?.name ?? 'the Foundation',
    declineTemplate: profile?.eoiDeclineLetterTemplate ?? null,
    inviteTemplate: profile?.eoiInviteTemplate ?? null,
    // Signed as the decline letter is: its own signatory, else the award letter's.
    signatory: profile?.declineLetterSignatory ?? profile?.awardLetterSignatory ?? null,
    senderName: profile?.awardLetterSenderName ?? client?.name ?? null,
    replyTo: profile?.awardLetterReplyTo ?? null,
  }
}

export const getEoiLetterSettings = createServerFn({ method: 'GET' }).handler(async () => {
  requireFeature('sourcing')
  const user = await requireRole('admin', 'superadmin')
  if (!user.clientId) return null
  return loadEoiLetterContext(user.clientId)
})

export const updateEoiLetterSettings = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      // `null` = Custodian's standard letter, as for the other two letters.
      declineTemplate: z.string().max(20_000).nullable().optional(),
      inviteTemplate: z.string().max(20_000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    // Only the keys sent, so saving one letter never clobbers the other.
    const fields: Partial<typeof clientProfiles.$inferInsert> = {}
    if (data.declineTemplate !== undefined) fields.eoiDeclineLetterTemplate = data.declineTemplate
    if (data.inviteTemplate !== undefined) fields.eoiInviteTemplate = data.inviteTemplate
    await getDb()
      .insert(clientProfiles)
      .values({ clientId: user.clientId, ...fields })
      .onConflictDoUpdate({
        target: clientProfiles.clientId,
        set: { ...fields, updatedAt: new Date() },
      })
    return { ok: true }
  })

// ─── The decline batch ────────────────────────────────────────────────────────

export type EoiDeclineRecipient = {
  eoiId: string
  organisationName: string
  applicantEmail: string | null
  letterStatus: 'draft' | 'sent' | 'failed' | null
  notifiedAt: string | null
  failureReason: string | null
}

async function scopedProgramme(user: { role: string; clientId: string | null }, id: string) {
  const programme = await getDb().query.programmes.findFirst({
    where: (p, { eq }) => eq(p.id, id),
    columns: { id: true, name: true, clientId: true },
  })
  if (!programme) throw notFoundError()
  assertClientAccess(user, programme.clientId)
  return programme
}

/**
 * Every EOI decline letter this foundation has already sent, or has queued, to one of
 * these addresses. `failed` letters are left out: they told nobody, so they must not
 * bar the address for good (see `planDeclineBatch`).
 */
async function addressesAlreadyWritten(
  clientId: string,
  emails: string[],
): Promise<AddressRecord[]> {
  if (emails.length === 0) return []
  const rows = await getDb()
    .select({
      email: eoiDeclineLetters.recipientEmail,
      at: eoiDeclineLetters.sentAt,
      programmeName: programmes.name,
    })
    .from(eoiDeclineLetters)
    .innerJoin(eois, eq(eoiDeclineLetters.eoiId, eois.id))
    .leftJoin(programmes, eq(eois.programmeId, programmes.id))
    .where(
      and(
        eq(eoiDeclineLetters.clientId, clientId),
        isNotNull(eoiDeclineLetters.recipientEmail),
        inArray(eoiDeclineLetters.status, ['sent', 'draft']),
        inArray(sql`lower(${eoiDeclineLetters.recipientEmail})`, emails),
      ),
    )
  // `roundName` is the shared type's word; for an EOI the batch it went out with is its
  // programme, which is what the dialog names.
  return rows.map((r) => ({
    email: r.email!,
    at: r.at ? r.at.toISOString() : null,
    roundName: r.programmeName,
  }))
}

function declinedInProgramme(clientId: string, programmeId: string, ids?: string[]) {
  return getDb()
    .select({
      eoiId: eois.id,
      organisationName: eois.organisationName,
      applicantEmail: eois.contactEmail,
      letterId: eoiDeclineLetters.id,
      letterStatus: eoiDeclineLetters.status,
      sentAt: eoiDeclineLetters.sentAt,
      failureReason: eoiDeclineLetters.failureReason,
    })
    .from(eois)
    .leftJoin(eoiDeclineLetters, eq(eoiDeclineLetters.eoiId, eois.id))
    .where(
      and(
        eq(eois.clientId, clientId),
        eq(eois.programmeId, programmeId),
        eq(eois.status, 'declined'),
        ids ? inArray(eois.id, ids) : undefined,
      ),
    )
    .orderBy(eois.organisationName)
}

/** Who the EOI decline letters for one programme would go to, and who is left out. */
export const getEoiDeclineBatch = createServerFn({ method: 'GET' })
  .validator(z.object({ programmeId: z.uuid() }))
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('admin', 'superadmin')
    const programme = await scopedProgramme(user, data.programmeId)

    const [rows, waiting, context] = await Promise.all([
      declinedInProgramme(programme.clientId, programme.id),
      getDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(eois)
        .where(
          and(
            eq(eois.clientId, programme.clientId),
            eq(eois.programmeId, programme.id),
            eq(eois.status, 'submitted'),
          ),
        ),
      loadEoiLetterContext(programme.clientId),
    ])
    const emails = [
      ...new Set(
        rows.filter((r) => r.applicantEmail).map((r) => normaliseEmail(r.applicantEmail!)),
      ),
    ]

    return {
      programmeName: programme.name,
      recipients: rows.map(
        (r): EoiDeclineRecipient => ({
          eoiId: r.eoiId,
          organisationName: r.organisationName,
          applicantEmail: r.applicantEmail,
          letterStatus: r.letterStatus ?? null,
          notifiedAt: r.sentAt ? r.sentAt.toISOString() : null,
          failureReason: r.failureReason ?? null,
        }),
      ),
      previouslyWritten: await addressesAlreadyWritten(programme.clientId, emails),
      stillToReview: waiting[0]?.n ?? 0,
      settings: context,
    }
  })

/**
 * Render and store a decline letter for each declined EOI the admin left ticked, then
 * queue the sends. The eligible set is re-derived here; the posted ids only narrow it.
 */
export const sendEoiDeclineLetters = createServerFn({ method: 'POST' })
  .validator(z.object({ programmeId: z.uuid(), eoiIds: z.array(z.uuid()).min(1).max(500) }))
  .handler(async ({ data }) => {
    requireFeature('sourcing')
    const user = await requireRole('admin', 'superadmin')
    const programme = await scopedProgramme(user, data.programmeId)

    const eligible = await declinedInProgramme(programme.clientId, programme.id, data.eoiIds)
    const emails = [
      ...new Set(
        eligible.filter((r) => r.applicantEmail).map((r) => normaliseEmail(r.applicantEmail!)),
      ),
    ]
    const plan = planDeclineBatch({
      candidates: eligible.map((r) => ({
        ...r,
        letterStatus: r.letterId ? ('sent' as const) : null,
      })),
      previouslyWritten: await addressesAlreadyWritten(programme.clientId, emails),
    })
    const skipped =
      plan.alreadyNotified.length +
      plan.addressAlreadyWritten.length +
      plan.duplicateInBatch.length +
      plan.unnamed.length
    if (plan.toNotify.length === 0) {
      return { sent: 0, withoutEmail: plan.unreachable.length, skipped }
    }

    const ctx = await loadEoiLetterContext(programme.clientId)
    const issuedAt = new Date()
    // The unreachable get their letter too, at `draft`, to send once an address exists.
    const values = [...plan.toNotify, ...plan.unreachable].map((r) => {
      const letter = renderEoiDecline(
        {
          organisationName: r.organisationName,
          foundationName: ctx.foundationName,
          programmeName: programme.name,
          signatory: ctx.signatory,
          issuedAt,
        },
        ctx.declineTemplate,
      )
      return {
        eoiId: r.eoiId,
        clientId: programme.clientId,
        subject: letter.subject,
        bodyText: letter.bodyText,
        bodyHtml: letter.bodyHtml,
        recipientEmail: r.applicantEmail,
        replyTo: ctx.replyTo,
        senderName: ctx.senderName,
        status: 'draft' as const,
        failureReason: r.applicantEmail
          ? null
          : 'No contact email on the expression of interest. Add one, then send again.',
      }
    })

    // The constraint, on top of the filter, is what makes two admins pressing at once
    // produce one letter each rather than two.
    const written = await getDb()
      .insert(eoiDeclineLetters)
      .values(values)
      .onConflictDoNothing({ target: eoiDeclineLetters.eoiId })
      .returning({ id: eoiDeclineLetters.id, recipientEmail: eoiDeclineLetters.recipientEmail })

    const sendable = written.filter((w) => w.recipientEmail)
    await enqueueMany(
      sendable.map((w) => ({ kind: 'eoi_decline_letter' as const, letterId: w.id })),
      (message) =>
        message.kind === 'eoi_decline_letter'
          ? sendStoredEoiDeclineLetter(message.letterId)
          : Promise.resolve(),
    )
    return { sent: sendable.length, withoutEmail: written.length - sendable.length, skipped }
  })
