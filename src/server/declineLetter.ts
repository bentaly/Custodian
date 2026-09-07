// ─── Sending a decline letter ───────────────────────────────────────────────────
//
// The IO half. Rendering is pure and lives in `src/lib/declineLetter`, so the letters
// an admin previews in the dialog are produced by the same code that stores them.
//
// The split of work between here and `fns/declineLetters.ts` is deliberate and is the
// whole safety model. The server fn RENDERS and STORES every letter in the batch — one
// database round trip, no email — and this file SENDS one already-stored letter at a
// time, off the queue. So:
//
//   · the bytes an applicant receives are the bytes the admin previewed and the
//     database committed, not a re-render against a template that may since have moved;
//   · a retried queue message re-sends a letter rather than inventing a second one;
//   · a batch of forty costs forty small invocations instead of one that runs out of
//     subrequests two thirds of the way through a round.

import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { declineLetters } from '../../drizzle/schema'
import { sendAwardLetterEmail } from '../lib/email'

/**
 * Email one stored decline letter and record what happened.
 *
 * Never throws for a mail failure — the outcome belongs ON the row, where the dialog
 * and the application screen can show it. It DOES throw when the row cannot be read or
 * written, because that is the retryable case the queue exists to retry.
 *
 * Already-sent rows return without sending. Cloudflare Queues deliver at least once and
 * the button is pressable twice; telling a charity twice that it did not get the grant
 * is the failure this guard exists to prevent.
 */
export async function sendStoredDeclineLetter(
  letterId: string,
): Promise<{ status: 'sent' | 'draft' | 'failed'; error?: string }> {
  const db = getDb()
  const letter = await db.query.declineLetters.findFirst({
    where: (l, { eq }) => eq(l.id, letterId),
  })
  if (!letter) return { status: 'failed', error: 'Letter not found' }
  if (letter.status === 'sent') return { status: 'sent' }

  if (!letter.recipientEmail) {
    // Stays `draft`, matching the award letter: the document exists and can go out once
    // somebody supplies an address. `failed` would say the attempt was made.
    return { status: 'draft', error: 'No contact email on the application.' }
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
    .update(declineLetters)
    .set({
      status: result.ok ? 'sent' : 'failed',
      failureReason: result.error ?? null,
      sentAt: result.ok ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(declineLetters.id, letterId))

  return result.ok ? { status: 'sent' } : { status: 'failed', error: result.error }
}
