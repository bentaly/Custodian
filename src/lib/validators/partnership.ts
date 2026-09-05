import { z } from 'zod'
import { PARTNERSHIP_STATUSES } from '../partnerships/status'

/**
 * What the "Log a partner" dialog saves. One schema for create and edit — `id` absent
 * creates, as `SaveProgrammeSchema` does.
 *
 * The organisation's NAME is the only required field, and that is the point of the
 * screen. A prospect is logged in the thirty seconds after a conversation, from a
 * phone, with nothing to hand but a name and where you met them. A form that demanded a
 * charity number and a programme first would simply not be filled in, and the
 * relationship would go back to living in somebody's inbox — which is the problem this
 * replaces. Everything else is added later, on the record.
 */
export const SavePartnershipSchema = z.object({
  /** Absent creates a partnership; present edits that one. */
  id: z.uuid().optional(),
  organisationName: z.string().trim().min(1, 'Name the organisation').max(255),
  reference: z.string().trim().max(100).nullable(),
  organisationType: z.string().trim().max(120).nullable(),
  location: z.string().trim().max(255).nullable(),
  // Not validated beyond a length: the Charity Commission's own numbers, Scottish
  // SC-prefixed ones and Companies House's zero-padded ones are three different shapes,
  // and `runDueDiligence` already normalises what it is given. Rejecting a number here
  // because it looked wrong to us would block a screening that would have worked.
  charityNumber: z.string().trim().max(40).nullable(),
  companyNumber: z.string().trim().max(40).nullable(),
  source: z.string().trim().max(120).nullable(),
  programmeId: z.uuid().nullable(),
  tags: z.array(z.string().trim().min(1).max(100)).max(20),
  contactName: z.string().trim().max(255).nullable(),
  // Not `z.email()`: a half-typed address is worth keeping — the field is a note about
  // who to ring, not a send target. Nothing in this module emails anyone; the invite
  // actions open the admin's own mail client (see `PartnershipActions`).
  contactEmail: z.string().trim().max(255).nullable(),
  amountSought: z.number().nonnegative().nullable(),
  /** The first line of the relationship history — "Introduced by James at the May board". */
  note: z.string().trim().max(4000).nullable(),
})
export type SavePartnershipInput = z.infer<typeof SavePartnershipSchema>

export const PartnershipStatusSchema = z.enum(PARTNERSHIP_STATUSES)

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
