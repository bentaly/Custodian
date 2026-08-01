// ─── Issuing award letters ──────────────────────────────────────────────────────
//
// The IO half of the award letter: store the rendered snapshot, then try to email it.
// Rendering itself is pure and lives in `src/lib/awardLetter`, so the preview the admin
// approves during set-up is produced by the same code that stores the record.

import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { awardLetters } from '../../drizzle/schema'
import { sendAwardLetterEmail } from '../lib/email'
import type { RenderedAwardLetter } from '../lib/awardLetter'

export type LetterDelivery = {
  recipientEmail: string | null
  replyTo: string | null
  senderName: string | null
}

/**
 * Persist a rendered letter against its award, then attempt delivery and record the
 * outcome. Safe to call for an award that already has a letter — the row is upserted,
 * so a resend replaces the delivery state without duplicating the document.
 *
 * Never throws: this runs in the background after the award is already committed, and a
 * mail failure must leave a visible `failed` letter to retry, not an unhandled
 * rejection. An award with no applicant email stays `draft` for the same reason —
 * the letter still exists to read and can be sent once the address is known.
 */
export async function issueAwardLetter({
  awardId,
  clientId,
  letter,
  delivery,
}: {
  awardId: string
  clientId: string
  letter: RenderedAwardLetter
  delivery: LetterDelivery
}): Promise<{ status: 'sent' | 'draft' | 'failed'; error?: string }> {
  const { recipientEmail, replyTo, senderName } = delivery

  let status: 'sent' | 'draft' | 'failed' = 'draft'
  let failureReason: string | null = null
  if (recipientEmail) {
    const result = await sendAwardLetterEmail({
      to: recipientEmail,
      replyTo,
      senderName,
      subject: letter.subject,
      html: letter.bodyHtml,
      text: letter.bodyText,
    })
    status = result.ok ? 'sent' : 'failed'
    failureReason = result.error ?? null
  } else {
    failureReason = 'No contact email on the application — add one, then resend.'
  }

  const values = {
    awardId,
    clientId,
    subject: letter.subject,
    bodyText: letter.bodyText,
    bodyHtml: letter.bodyHtml,
    conditions: letter.conditions,
    status,
    recipientEmail: recipientEmail ?? null,
    replyTo: replyTo ?? null,
    senderName: senderName ?? null,
    failureReason,
    sentAt: status === 'sent' ? new Date() : null,
  }

  try {
    await getDb()
      .insert(awardLetters)
      .values(values)
      .onConflictDoUpdate({
        target: awardLetters.awardId,
        set: { ...values, updatedAt: new Date() },
      })
  } catch (err) {
    console.error(`[awardLetter] failed to store letter for award ${awardId}:`, err)
  }

  return failureReason ? { status, error: failureReason } : { status }
}

/**
 * Resend a letter already on file. Deliberately re-sends the STORED bytes rather than
 * re-rendering: the letter is the record of what was agreed, so a resend must be the
 * same document even if the template or the schedule has moved on since.
 */
export async function resendStoredLetter(
  letterId: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = getDb()
  const letter = await db.query.awardLetters.findFirst({ where: (l, { eq }) => eq(l.id, letterId) })
  if (!letter) return { ok: false, error: 'Letter not found' }
  if (!letter.recipientEmail) {
    return { ok: false, error: 'No contact email on the application to send to.' }
  }

  const result = await sendAwardLetterEmail({
    to: letter.recipientEmail,
    replyTo: letter.replyTo,
    senderName: letter.senderName,
    subject: letter.subject,
    html: letter.bodyHtml,
    text: letter.bodyText,
  })

  await db
    .update(awardLetters)
    .set({
      status: result.ok ? 'sent' : 'failed',
      failureReason: result.error ?? null,
      sentAt: result.ok ? new Date() : letter.sentAt,
      updatedAt: new Date(),
    })
    .where(eq(awardLetters.id, letterId))

  return result
}
