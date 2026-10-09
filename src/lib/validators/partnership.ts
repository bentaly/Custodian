import { z } from 'zod'
import { SHORTLIST_FIELDS } from './shortlistFields'
import { OUTREACH_KINDS } from '../sourcing/outreach'

/**
 * What the "Log a partner" dialog saves. One schema for create and edit — `id` absent
 * creates, as `SaveProgrammeSchema` does.
 *
 * Cut down on 2026-10-04 to what earns its place on one of the four routes to an
 * application: due diligence and the assessment need a registration number, a round and
 * programme, a value and a purpose; taking a partner straight to the shortlist needs the
 * delivery area and an email too. Anything an application form would ask again (type,
 * address, a contact's name, our own reference) is not asked here, because on the routes
 * through a form the applicant answers it, and on the direct route nothing reads it.
 *
 * Required: a number (either), the name (filled from the register), the round, the value
 * and the purpose. With all four of the assessment's inputs required, it always runs.
 */
export const SavePartnershipSchema = z
  .object({
    /** Absent creates a partnership; present edits that one. */
    id: z.uuid().optional(),
    organisationName: z.string().trim().min(1, 'Name the organisation').max(255),
    // Not validated beyond a length: the Charity Commission's own numbers, Scottish
    // SC-prefixed ones and Companies House's zero-padded ones are three different shapes,
    // and `runDueDiligence` already normalises what it is given.
    charityNumber: z.string().trim().max(40).nullable(),
    companyNumber: z.string().trim().max(40).nullable(),
    source: z.string().trim().max(120).nullable(),
    /** The round and programme together. The programme is derived from it on the server. */
    roundProgrammeId: z.uuid('Choose the round and programme'),
    deliveryArea: z.string().trim().max(255).nullable(),
    // Not `z.email()`: a half-typed address is worth keeping as a note. It is validated
    // where it becomes a send target (`SendPartnershipEmailSchema`).
    contactEmail: z.string().trim().max(255).nullable(),
    amountSought: z
      .number('Enter the grant value proposed')
      .positive('Enter the grant value proposed')
      .max(1_000_000_000),
    /** What the grant would be for, in the foundation's words. Feeds the assessment. */
    proposedPurpose: z.string().trim().min(1, 'Say what the grant would be for').max(4000),
    /** The impact the grant would have, in the programme's unit. The whole award, not a year. */
    proposedImpactQuantity: z.number().nonnegative().max(1_000_000_000).nullable(),
    /** The first line of the relationship history — "Introduced by James at the May board". */
    note: z.string().trim().max(4000).nullable(),
  })
  .refine((v) => !!(v.charityNumber || v.companyNumber), {
    message: 'Enter a charity number or a company number',
    path: ['charityNumber'],
  })
export type SavePartnershipInput = z.infer<typeof SavePartnershipSchema>

/**
 * Moving a partnership along. `action` rather than a target status, because the pipeline
 * is a set of MOVES and only some are legal from any given state (`canTransition`) —
 * accepting a bare status would let a stale screen post one that never had a button.
 */
export const PartnershipActionSchema = z.object({
  id: z.uuid(),
  action: z.enum(['issue_eoi', 'invite', 'decline', 'reopen']),
  /** Added to the timeline entry the move writes, when the admin says why. */
  note: z.string().trim().max(4000).nullable().optional(),
})

export const PartnershipNoteSchema = z.object({
  id: z.uuid(),
  body: z.string().trim().min(1, 'Write something').max(4000),
})

export const ArchivePartnershipSchema = z.object({
  id: z.uuid(),
  archived: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
})

/**
 * An email Custodian sends to a partner on the foundation's behalf. `to` is validated
 * here, where the address becomes a send target, rather than on the record.
 *
 * `formUrl` is the foundation's own form, required for the two invitations. The server
 * puts the invitation reference on it; the admin never types the reference.
 */
export const SendPartnershipEmailSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(OUTREACH_KINDS),
    to: z.email('Enter the email address to send to').max(255),
    subject: z.string().trim().min(1, 'Give the email a subject').max(200),
    body: z.string().trim().min(1, 'Write the email').max(8000),
    formUrl: z.url().max(2000).nullable(),
  })
  .refine((v) => v.kind === 'message' || !!v.formUrl, {
    message: 'Add the link to your form',
    path: ['formUrl'],
  })

/**
 * Taking a partner straight to the shortlist. The round is the partnership's own, chosen
 * when it was logged; the amount is confirmed here because it is the figure the round's
 * budget will be drawn on.
 */
/**
 * Taking a partnership straight to the shortlist (route 1). Everything the dialog asks
 * is prefilled from what was logged and may be corrected there; the corrections are
 * written back to the partnership as well as onto the application, so the two records
 * say the same thing about the same grant.
 */
export const ProgressPartnershipSchema = z.object({
  id: z.uuid(),
  amount: z.number().positive('Enter the grant value proposed').max(1_000_000_000),
  ...SHORTLIST_FIELDS,
})

/** Pointing a partnership at the application it turned into, by hand. */
export const LinkPartnershipApplicationSchema = z.object({
  id: z.uuid(),
  applicationId: z.uuid(),
})
