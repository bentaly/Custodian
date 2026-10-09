// ─── Sending an EOI decline letter ───────────────────────────────────────────────
//
// `declineLetter.ts`'s twin for the `eoi_decline_letters` table, and the same safety
// model: the batch renders and stores every letter, this sends one stored letter at a
// time off the queue, a sent row is never sent again, and a mail failure lands on the
// row rather than throwing (only an unreadable or unwritable row throws, which is the
// case the queue retries).

import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { eoiDeclineLetters } from '../../drizzle/schema'
import { sendAwardLetterEmail } from '../lib/email'

export async function sendStoredEoiDeclineLetter(
  letterId: string,
): Promise<{ status: 'sent' | 'draft' | 'failed'; error?: string }> {
  const db = getDb()
  const letter = await db.query.eoiDeclineLetters.findFirst({
    where: (l, { eq }) => eq(l.id, letterId),
  })
  if (!letter) return { status: 'failed', error: 'Letter not found' }
  if (letter.status === 'sent') return { status: 'sent' }
  if (!letter.recipientEmail) {
    return { status: 'draft', error: 'No contact email on the expression of interest.' }
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
    .update(eoiDeclineLetters)
    .set({
      status: result.ok ? 'sent' : 'failed',
      failureReason: result.error ?? null,
      sentAt: result.ok ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(eoiDeclineLetters.id, letterId))

  return result.ok ? { status: 'sent' } : { status: 'failed', error: result.error }
}
