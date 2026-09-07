import { z } from 'zod'

/** The foundation's decline-letter configuration, edited on Settings → Letters. */
export const DeclineLetterSettingsSchema = z.object({
  // `null` clears the override back to the built-in, which is deliberately different
  // from `''` (a foundation cannot send an empty letter).
  template: z.string().max(20_000).nullable().optional(),
  signatory: z.string().max(200).nullable().optional(),
})
export type DeclineLetterSettingsInput = z.infer<typeof DeclineLetterSettingsSchema>

/**
 * Notify the unsuccessful applicants in one round.
 *
 * The round is carried alongside the ids and both are enforced: the ids say which of
 * the batch the admin left ticked, the round is the scope the server re-derives the
 * eligible set from. An id that is not a declined, not-yet-notified application in that
 * round is dropped rather than trusted — the request is a request, never the authority
 * on who may be emailed.
 *
 * The cap is high because it is a whole round of unsuccessful applicants, and low
 * enough that one request cannot render an unbounded number of letters.
 */
export const SendDeclineLettersSchema = z.object({
  roundId: z.uuid(),
  applicationIds: z.array(z.uuid()).min(1).max(500),
})
export type SendDeclineLettersInput = z.infer<typeof SendDeclineLettersSchema>
