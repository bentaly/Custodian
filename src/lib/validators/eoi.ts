import { z } from 'zod'

/** Closing an EOI, or putting it back to review. Inviting is its own call: it may email. */
export const DecideEoiSchema = z.object({
  id: z.uuid(),
  action: z.enum(['decline', 'reopen']),
  note: z.string().trim().max(2000).nullable().optional(),
})

/**
 * Inviting whoever sent an EOI to make a full application.
 *
 * `send: true` has Custodian email the link to the foundation's own application form,
 * with the invitation reference on it; `send: false` is the admin saying they have
 * already done it themselves, and needs none of the email fields.
 */
export const InviteEoiSchema = z
  .object({
    id: z.uuid(),
    send: z.boolean(),
    to: z.email('Enter the email address to send to').max(255).nullable(),
    subject: z.string().trim().max(200).nullable(),
    body: z.string().trim().max(8000).nullable(),
    formUrl: z.url().max(2000).nullable(),
  })
  .refine((v) => !v.send || (!!v.to && !!v.subject && !!v.body && !!v.formUrl), {
    message: 'An address, a subject, the email and the link to your form are all needed to send it',
    path: ['to'],
  })

/** Filing an EOI under a programme, or taking it out of one. */
export const SetEoiProgrammeSchema = z.object({
  id: z.uuid(),
  programmeId: z.uuid().nullable(),
})

/**
 * Taking an EOI straight to the shortlist (route 3). An EOI is thinner than an
 * application, so the dialog asks for what the application cannot do without, prefilled
 * from the EOI wherever it was recognised. The round is asked for unless a sourced
 * partner's EOI already has one from its partnership.
 */
export const ProgressEoiSchema = z.object({
  id: z.uuid(),
  roundProgrammeId: z.uuid('Choose the round and programme'),
  amount: z.number().positive('Enter the grant value proposed').max(1_000_000_000),
  purpose: z.string().trim().min(1, 'Say what the grant would be for').max(4000),
  deliveryArea: z.string().trim().max(255).nullable(),
  contactEmail: z.email('Enter a valid email address').max(255).nullable(),
})
