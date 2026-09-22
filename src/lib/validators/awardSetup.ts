import { z } from 'zod'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Terms shared by every grant in one set-up run. A board approves several grants in a
 * sitting and they almost always share a start date, payment cadence and reporting
 * rhythm — so these are set once and the per-grant step only carries what genuinely
 * differs (amount, purpose, any bespoke condition).
 */
export const AwardTermsSchema = z.object({
  startDate: z.string().regex(ISO_DATE, 'Expected yyyy-mm-dd'),
  /**
   * How long these grants run, in years, where the admin has said.
   *
   * NULL is "nobody stated one", and the award then falls back to
   * `round_programmes.grant_duration_years` exactly as an imported grant does. That is
   * also what a batch spanning rounds of different lengths sends, so each grant keeps
   * its own round's answer rather than being flattened to one of them.
   *
   * NOT an input to the schedule, which is built from the instalment rows themselves.
   */
  durationYears: z.number().int().positive().max(50).nullable().default(null),
  /** Whether the foundation's standard conditions are attached to these awards. */
  useStandardConditions: z.boolean().default(true),
  reporting: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        dueDate: z.string().regex(ISO_DATE, 'Expected yyyy-mm-dd'),
      }),
    )
    .max(24)
    .default([]),
})
export type AwardTerms = z.infer<typeof AwardTermsSchema>

/** One grant within a batch: the application it comes from, and what differs about it. */
export const AwardGrantSchema = z.object({
  applicationId: z.uuid(),
  amountAwarded: z.number().positive(),
  purpose: z.string().trim().max(2000).nullable().default(null),
  specialCondition: z.string().trim().max(2000).nullable().default(null),
  schedule: z
    .array(
      z.object({
        instalment: z.number().int().positive(),
        amount: z.number().positive(),
        // ISO yyyy-mm-dd. Required: an undated instalment has no financial year to fall
        // in, so every budget and cash-flow figure would silently leave it out.
        date: z.string().regex(ISO_DATE, 'Expected yyyy-mm-dd'),
      }),
    )
    .min(1)
    .max(48),
})
export type AwardGrant = z.infer<typeof AwardGrantSchema>

export const CreateAwardsSchema = z.object({
  terms: AwardTermsSchema,
  // Capped well above any realistic board sitting; the batch is processed one grant at
  // a time so a large run is slow rather than dangerous, but an unbounded array would
  // let one request hold a Worker open indefinitely.
  grants: z.array(AwardGrantSchema).min(1).max(50),
})
export type CreateAwardsInput = z.infer<typeof CreateAwardsSchema>

export const AwardLetterSettingsSchema = z.object({
  // `null` clears the override back to the built-in default, which is deliberately
  // different from `''` (a foundation cannot send an empty letter).
  template: z.string().max(20_000).nullable().optional(),
  conditions: z.array(z.string().trim().min(1).max(2000)).max(50).nullable().optional(),
  signatory: z.string().trim().max(200).nullable().optional(),
  senderName: z.string().trim().max(200).nullable().optional(),
  replyTo: z
    .union([z.email().max(255), z.literal('')])
    .nullable()
    .optional(),
})
export type AwardLetterSettingsInput = z.infer<typeof AwardLetterSettingsSchema>
