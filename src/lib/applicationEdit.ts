// ─── Editing an application ──────────────────────────────────────────────────
//
// An admin can change how an application READS in Custodian: fill in an amount the
// mapper could not find, make a delivery area specific enough to measure, correct a
// charity number, add bank details. The submission as it arrived is never touched;
// it stays in `application_ingests.raw_payload`, and View Submission shows it with a
// note beneath each answer Custodian now reads differently.
//
// There are two ways to fill a field, and the difference is the point:
//
//   typed  - the admin types the value. It fixes this application and teaches nothing.
//   answer - the admin points at one of the applicant's own answers. It fixes this
//            application, can teach the foundation's mapping so the next submission
//            reads that answer the same way, and can fill in the other applications
//            that answered the same question and are missing the same field.
//
// What is NOT editable, and why:
//   - the foundation's reference: report auto-linking and re-send dedupe key on it
//   - the programme: moving an application is a move, not an edit (it changes whose
//     budget it counts against and which themes it can have), and is not built
//   - the applicant's prose (their answers, their description of themselves): that is
//     the applicant speaking, and the assessment reads it
//   - anything derived (score, decile, due diligence): change the input and it re-runs
//   - anything at all once a grant has been awarded: the award letter was written from
//     these figures
//
// Pure. The IO lives in `server/applications/edit.ts`.

import { CANONICAL_FIELD_BY_KEY, toStringValue, type CanonicalFieldKey } from './fieldMapping'
import type { CreateApplicationInput } from './validators/application'
import { isUnnamedOrganisation } from './organisationName'

/** The fields an admin may edit, in the order the edit surfaces offer them. */
export const EDITABLE_FIELDS = [
  'organisationName',
  'applicantEmail',
  'charityNumber',
  'companyNumber',
  'amountRequested',
  'proposedImpactQuantity',
  'unrestrictedReserves',
  'deliveryArea',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
  'bankSortCode',
] as const satisfies readonly CanonicalFieldKey[]

export type EditableField = (typeof EDITABLE_FIELDS)[number]

const EDITABLE_SET = new Set<string>(EDITABLE_FIELDS)
export function isEditableField(key: string): key is EditableField {
  return EDITABLE_SET.has(key)
}

/** Stored as numbers; everything else is text. */
const NUMERIC_FIELDS = new Set<EditableField>([
  'amountRequested',
  'proposedImpactQuantity',
  'unrestrictedReserves',
])

export function isNumericField(field: EditableField): boolean {
  return NUMERIC_FIELDS.has(field)
}

export function editableFieldLabel(field: EditableField): string {
  return CANONICAL_FIELD_BY_KEY[field].label
}

/**
 * A figure written the way people write figures on forms: "£24,000", "24000",
 * "24,000.00". Anything with words in it ("24k over two years", "about fifteen
 * thousand") is NOT read, because `coerceAmount` would strip it to "24" and that is
 * £24. A person reads those; see `strictReading`.
 */
const PLAIN_FIGURE = /^\s*£?\s*\d{1,3}(,\d{3})*(\.\d+)?\s*$|^\s*£?\s*\d+(\.\d+)?\s*$/

/**
 * What an answer reads as for a field, when that reading is certain enough to apply
 * WITHOUT a person looking: the "also fill in the others" path, and the prefill in the
 * answer picker. `null` means "a person must read this one".
 */
export function strictReading(field: EditableField, raw: unknown): string | null {
  const text = toStringValue(raw).trim()
  if (!text) return null
  if (isNumericField(field)) {
    if (!PLAIN_FIGURE.test(text)) return null
    const n = Number(text.replace(/[£,\s]/g, ''))
    return Number.isFinite(n) && n >= 0 ? String(n) : null
  }
  const coerce = CANONICAL_FIELD_BY_KEY[field].coerce
  return coerce ? coerce(text) : text
}

/**
 * Does an answer LOOK like a value of this field? A cheap shape test, for putting the
 * plausible answers first in the answer picker: on a 38-question form the amount is one
 * answer among dozens of paragraphs. Never used to choose, only to order.
 */
export function looksLike(field: EditableField, raw: string): boolean {
  const v = raw.trim()
  if (!v) return false
  switch (field) {
    case 'amountRequested':
    case 'unrestrictedReserves':
    case 'proposedImpactQuantity':
      // A figure somewhere in a short answer ("58k across three years" counts; a
      // paragraph that mentions "two estates" does not).
      return /\d/.test(v) && v.length <= 80
    case 'applicantEmail':
      return /\S+@\S+\.\S+/.test(v)
    case 'bankSortCode':
      return /^\d{2}[-\s]?\d{2}[-\s]?\d{2}$/.test(v)
    case 'bankAccountNumber':
      return /^\d{6,10}$/.test(v.replace(/\s/g, ''))
    case 'charityNumber':
    case 'companyNumber':
      return /^[A-Z]{0,2}\d{5,8}(-\d+)?$/i.test(v.replace(/\s/g, ''))
    case 'deliveryArea':
      // A place is a few words, not a paragraph, and not a figure.
      return v.length <= 60 && !/^[£\d,.\s]+$/.test(v)
    case 'organisationName':
    case 'bankName':
    case 'bankAccountName':
      return v.length <= 120 && !v.includes('\n')
  }
}

export type RankedAnswer = { label: string; value: string; likely: boolean }

/**
 * The applicant's unused answers in the order the picker offers them:
 *   1. the AI mapper's own best guess for this field, marked "likely" (it scored every
 *      answer when the submission arrived, and stored its pick even when it was below
 *      the confidence bar and so applied nothing),
 *   2. answers shaped like the field (`looksLike`),
 *   3. the rest.
 * The applicant's order is kept within each group, so the list still reads like their
 * form. `proposal` is `application_ingests.proposed[field]`.
 */
export function rankAnswers(
  field: EditableField,
  answers: Array<{ label: string; value: string }>,
  proposal: { sourceKey: string | null; confidence: number } | null | undefined,
): RankedAnswer[] {
  const guess = proposal?.sourceKey && proposal.confidence > 0 ? proposal.sourceKey : null
  const group = (a: { label: string; value: string }) =>
    a.label === guess ? 0 : looksLike(field, a.value) ? 1 : 2
  return answers
    .map((a, i) => ({ ...a, likely: a.label === guess, g: group(a), i }))
    .sort((x, y) => x.g - y.g || x.i - y.i)
    .map(({ label, value, likely }) => ({ label, value, likely }))
}

/**
 * The application's current canonical values, as the input `updateApplicationFromCanonical`
 * takes. Built from the ROW, not re-derived from the ingest: the row is the truth, and
 * has been changed by paths the ingest never saw (a registration number supplied from
 * the due diligence panel, a previous edit).
 */
export function canonicalFromApplication(app: {
  roundProgrammeId: string
  externalApplicationId: string | null
  organisationName: string
  organisationSummary: string | null
  applicantEmail: string | null
  charityNumber: string | null
  companyNumber: string | null
  deliveryArea: string | null
  bankName: string | null
  bankAccountName: string | null
  bankAccountNumber: string | null
  bankSortCode: string | null
  amountRequested: string | null
  unrestrictedReserves: string | null
  proposedImpactQuantity: string | null
  budgetBreakdown: CreateApplicationInput['budgetBreakdown'] | null
  budgetBreakdownLink: string | null
  responses: Array<{ label: string; value: string }> | null
  submittedFields: Array<{ label: string; canonical: string | null }> | null
}): CreateApplicationInput {
  const text = (v: string | null) => (v == null || v.trim() === '' ? undefined : v)
  const num = (v: string | null) => (v == null || v === '' ? undefined : Number(v))
  return {
    roundProgrammeId: app.roundProgrammeId,
    externalApplicationId: text(app.externalApplicationId),
    organisationName: isUnnamedOrganisation(app.organisationName)
      ? undefined
      : app.organisationName,
    organisationSummary: text(app.organisationSummary),
    applicantEmail: text(app.applicantEmail),
    charityNumber: text(app.charityNumber),
    companyNumber: text(app.companyNumber),
    deliveryArea: text(app.deliveryArea),
    bankName: text(app.bankName),
    bankAccountName: text(app.bankAccountName),
    bankAccountNumber: text(app.bankAccountNumber),
    bankSortCode: text(app.bankSortCode),
    amountRequested: num(app.amountRequested),
    unrestrictedReserves: num(app.unrestrictedReserves),
    proposedImpactQuantity: num(app.proposedImpactQuantity),
    budgetBreakdown: app.budgetBreakdown ?? undefined,
    budgetBreakdownLink: text(app.budgetBreakdownLink),
    responses: app.responses ?? [],
    submittedFields: app.submittedFields ?? undefined,
  }
}

/** A field's current value as the text an edit row records ("" and null are both null). */
export function fieldText(input: CreateApplicationInput, field: EditableField): string | null {
  const v = input[field]
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

export type SetFieldResult =
  | { ok: true; input: CreateApplicationInput }
  | { ok: false; message: string }

/**
 * Set one field on the input, from what a person typed or confirmed. An empty value
 * CLEARS the field, which is allowed for everything but the organisation name, the one
 * editable field an application cannot exist without. Validation proper happens on the
 * whole input afterwards (`CreateApplicationSchema`); this only turns text into the
 * field's type and refuses what can never be a value of it.
 */
export function setField(
  input: CreateApplicationInput,
  field: EditableField,
  raw: string | null,
): SetFieldResult {
  const text = (raw ?? '').trim()
  const label = editableFieldLabel(field)
  if (!text) {
    if (field === 'organisationName') {
      return { ok: false, message: 'An application needs an organisation name.' }
    }
    return { ok: true, input: { ...input, [field]: undefined } }
  }
  if (isNumericField(field)) {
    const n = Number(text.replace(/[£,\s]/g, ''))
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: `${label} must be a figure, such as 24000.` }
    }
    if (field === 'amountRequested' && n === 0) {
      return { ok: false, message: 'The amount requested must be more than £0.' }
    }
    return { ok: true, input: { ...input, [field]: n } }
  }
  const coerce = CANONICAL_FIELD_BY_KEY[field].coerce
  return { ok: true, input: { ...input, [field]: coerce ? coerce(text) : text } }
}

/**
 * Keep `responses` and `submittedFields` in step when an answer changes hands.
 *
 * `consume` is the answer now read as `field`: it stops being listed among the
 * applicant's other answers, and the submission index marks it as that field.
 * `release` is the answer the field was read from before (if any): it goes back among
 * the other answers, in the place the applicant gave it, so pointing a field at a
 * different answer never loses the old one.
 *
 * Applied as a change to the arrays already on the row rather than recomputed from the
 * payload, because the stored arrays carry things a recompute would drop (a prose
 * budget kept as a response when it could not be read as lines).
 */
export function moveAnswer(params: {
  responses: Array<{ label: string; value: string }>
  submittedFields: Array<{ label: string; canonical: string | null }> | undefined
  payload: Record<string, unknown>
  /** The sender's order, from the ingest. */
  order: string[]
  field: EditableField
  consume: string | null
  release: string | null
}): {
  responses: Array<{ label: string; value: string }>
  submittedFields: Array<{ label: string; canonical: string | null }> | undefined
} {
  const { payload, order, field, consume, release } = params
  let responses = params.responses.filter((r) => r.label !== consume)

  if (release && release !== consume && !responses.some((r) => r.label === release)) {
    const value = toStringValue(payload[release])
    if (value) {
      const at = order.indexOf(release)
      // Before the first response the applicant gave AFTER the released one.
      const insertAt = responses.findIndex((r) => {
        const i = order.indexOf(r.label)
        return i !== -1 && at !== -1 && i > at
      })
      responses =
        insertAt === -1
          ? [...responses, { label: release, value }]
          : [
              ...responses.slice(0, insertAt),
              { label: release, value },
              ...responses.slice(insertAt),
            ]
    }
  }

  const submittedFields = params.submittedFields?.map((f) =>
    f.label === consume
      ? { ...f, canonical: field }
      : f.label === release && f.canonical === field
        ? { ...f, canonical: null }
        : f,
  )
  return { responses, submittedFields }
}
