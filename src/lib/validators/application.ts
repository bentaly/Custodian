import { z } from 'zod'

export const ApplicationStatus = z.enum(['for_review', 'shortlisted', 'awarded', 'declined'])
export type ApplicationStatus = z.infer<typeof ApplicationStatus>

/**
 * The one place a status value becomes prose. Anything shown to a user goes through
 * here — the header search used to capitalise the raw value and printed "For_review"
 * at people.
 *
 * The table pill used to say "In review" while the filter said "For review", on the
 * grounds that Figma labelled the row context differently. That is not a distinction a
 * user can be expected to make: filtering by "For review" and reading "In review" in
 * the resulting rows reads as two different states. One status, one name — and the
 * screens now take it from here rather than keeping their own copy.
 */
const STATUS_LABELS: Record<ApplicationStatus, string> = {
  for_review: 'In review',
  shortlisted: 'Shortlisted',
  awarded: 'Awarded',
  declined: 'Declined',
}
export function applicationStatusLabel(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status
}
export const APPLICATION_STATUS_OPTIONS: Array<{ value: ApplicationStatus; label: string }> =
  ApplicationStatus.options.map((value) => ({ value, label: STATUS_LABELS[value] }))

// A single project-budget line. `amount` is in pounds (GBP) to the penny —
// decimals allowed — consistent with `amountRequested`/`amountAwarded`, which are
// `numeric`, not minor units. `details` preserves any further fields the
// foundation captured on the line beyond item and amount (we keep but don't
// interpret them — see budget/types.ts).
export const BudgetLineSchema = z.object({
  item: z.string().min(1).max(255),
  amount: z.number().positive(),
  details: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .max(50)
    .optional(),
})

export const CreateApplicationSchema = z.object({
  roundProgrammeId: z.uuid(),
  // The foundation's own application reference, when the application arrives via
  // the field-mapping ingest path. Optional so direct (canonical) submissions
  // still validate without one.
  externalApplicationId: z.string().min(1).max(255).optional(),
  organisationName: z.string().min(1).max(255),
  // The applicant's own description of their organisation. Optional — not every
  // foundation asks. The cap is generous because this is prose an applicant wrote into
  // a free-text box, not a field with a shape: the longest on Arete's live form runs to
  // 3,500 characters, and truncating one at the door would lose the tail of an answer
  // with nothing to say it had been cut.
  organisationSummary: z.string().min(1).max(20_000).optional(),
  // The applicant's contact email — required on every application.
  applicantEmail: z.string().email().max(255),
  // Both optional — an applicant may hold a charity number, a company number,
  // or both. Due diligence routing keys off whichever are present.
  charityNumber: z.string().max(50).optional(),
  companyNumber: z.string().max(50).optional(),
  // Free-text area where the project is delivered (community served). Optional.
  deliveryArea: z.string().max(255).optional(),
  // Optional, matching the `optional` tier in the canonical registry: the sort code
  // identifies the bank, and nothing but the payment panel's display reads this. Left
  // required here it would hold every submission from a form that doesn't ask for it,
  // however the tier was set — the tier decides whether the mapper waits for a field,
  // this decides whether the assembled application is allowed to exist without one.
  bankName: z.string().max(255).optional(),
  bankAccountName: z.string().min(1).max(255),
  bankAccountNumber: z.string().min(1).max(50),
  bankSortCode: z.string().min(1).max(20),
  amountRequested: z.number().positive(),
  // Unrestricted reserves as stated by the applicant, in pounds. Optional — not every
  // foundation asks, and no register publishes it. Non-negative: `buildCanonicalInput`
  // already refuses a negative figure rather than storing it, and this is the boundary
  // that makes that true of every path in, not just the mapper's.
  unrestrictedReserves: z.number().min(0).max(1_000_000_000).optional(),
  // The impact the applicant proposes to achieve, in the programme's impact unit
  // (people / trees / hectares …). Optional — not every foundation collects it.
  proposedImpactQuantity: z.number().min(0).max(1_000_000_000).optional(),
  // The project budget as line items. Optional — not every foundation collects
  // one. Deliberately NOT reconciled against `amountRequested`: the applicant may
  // be asking this funder for only part of the budget, so the lines legitimately
  // sum to more (or less) than the ask.
  budgetBreakdown: z.array(BudgetLineSchema).max(100).optional(),
  // A link to a budget document, where the foundation's form asks for a file instead
  // of fields. http(s) only: this is rendered as a link an admin clicks, and it
  // arrives from an applicant-filled form, so anything else is refused rather than
  // stored and put in front of someone.
  budgetBreakdownLink: z
    .string()
    .url()
    .max(2000)
    .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
      message: 'Budget document link must be an http(s) URL',
    })
    .optional(),
  responses: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  // The order the submission was actually made in — one entry per incoming field,
  // naming the canonical field it fed. Optional: a direct canonical submission has no
  // running order to preserve, and an application created any other way (an import)
  // was never a form. Carries no values, so nothing here can contradict the columns
  // above; the labels are the applicant's own question wording.
  //
  // The label cap must never be TIGHTER than the one on `responses` above (which has
  // none): the two carry the same strings — the incoming question wording — and the
  // index is written from the same payload keys in the same breath, so a cap only one
  // of them enforces refuses the whole application over a field the other would have
  // accepted. It was 500, and Arete's form ends with a 549-character declaration used
  // as a question title ("By submitting this application I confirm that I am authorised
  // to make this submission…"). Eight of their thirteen live submissions could not be
  // re-confirmed, and any new one carrying it would have been held in the review queue
  // over a length nobody could see. 2,000 is still a real bound — this is an index, and
  // a runaway key is what the cap is for — with a paragraph's clearance above the
  // longest wording a real form has produced.
  submittedFields: z
    .array(z.object({ label: z.string().max(2000), canonical: z.string().max(100).nullable() }))
    .max(500)
    .optional(),
})
export type CreateApplicationInput = z.infer<typeof CreateApplicationSchema>

// 'awarded' is deliberately not settable here: awarding must go through
// `createAwards` (which mints the award row, checks the trustee majority, issues the
// award letter and writes the audit trail), and un-awarding through cancelling the
// award.
export const UpdateApplicationStatusSchema = z.object({
  id: z.uuid(),
  status: z.enum(['for_review', 'shortlisted', 'declined']),
})
export type UpdateApplicationStatusInput = z.infer<typeof UpdateApplicationStatusSchema>

export const ScoreBand = z.enum(['90plus', '80to89', '70to79', 'below70'])
export type ScoreBand = z.infer<typeof ScoreBand>

export const ApplicationFiltersSchema = z.object({
  programmeId: z.uuid().optional(),
  roundId: z.uuid().optional(),
  status: ApplicationStatus.optional(),
  // Free-text search over the organisation name.
  q: z.string().trim().min(1).max(255).optional(),
  // AI ("Custodian") composite score band; only matches scored applications.
  scoreBand: ScoreBand.optional(),
  // Programme tag/theme — matches applications whose programme carries the tag.
  tag: z.string().min(1).max(100).optional(),
  // Inclusive submission-date window, as calendar days (`yyyy-mm-dd`).
  submittedFrom: z.iso.date().optional(),
  submittedTo: z.iso.date().optional(),
  // Column sort. Only base-table columns are sortable; programme/theme are the
  // grouping (tabs) and filter axes.
  sortBy: z
    .enum(['organisation', 'amount', 'received', 'status', 'score', 'dueDiligence'])
    .optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).default(1),
  // Cap is high enough to cover a whole-programme CSV export in one call.
  pageSize: z.number().int().min(1).max(10_000).default(25),
})
export type ApplicationFilters = z.infer<typeof ApplicationFiltersSchema>
