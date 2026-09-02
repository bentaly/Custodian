import { describe, expect, it } from 'vitest'
import { CreateApplicationSchema } from '../../lib/validators/application'
import {
  PROVIDED,
  buildCanonicalInput,
  buildSubmittedFields,
  computeResponses,
  providedValuesFor,
  resolvedFromMapping,
  resolvedMapFor,
} from '../fieldMapping/assemble'

// The confirm path's guard rails, tested without a database. `updateApplicationFromCanonical`
// itself is IO all the way down, but the decision that matters — what a reviewer's
// corrected mapping produces, and what it refuses to produce — is pure.

const PAYLOAD: Record<string, unknown> = {
  'Entry Id': '437930',
  'Organisation name': 'Amplify Youth Trust',
  'Contact email': 'team@example.org',
  'Registered charity number': '1104903',
  programmeName: 'Social Impact Funding',
  'How much funding are you requesting?': '10000',
  "Your bank's name": 'Barclays',
  'Your bank account name': 'Amplify Youth Trust',
  'Your bank account number': '12345678',
  'Your bank sort code': '20-00-00',
}

/** The mapping as the AI left it — everything but the charity number. */
const AI_MAPPING: Record<string, string> = {
  externalApplicationId: 'Entry Id',
  organisationName: 'Organisation name',
  applicantEmail: 'Contact email',
  programmeName: 'programmeName',
  amountRequested: 'How much funding are you requesting?',
  bankName: "Your bank's name",
  bankAccountName: 'Your bank account name',
  bankAccountNumber: 'Your bank account number',
  bankSortCode: 'Your bank sort code',
}

const ROUND_PROGRAMME_ID = '8139a353-d788-4a67-a5b9-83460e19ed42'

function canonicalFor(mapping: Record<string, string>) {
  const resolved = resolvedFromMapping(PAYLOAD, mapping)
  const responses = computeResponses(PAYLOAD, resolved)
  return CreateApplicationSchema.safeParse(
    buildCanonicalInput(ROUND_PROGRAMME_ID, resolved, responses),
  )
}

describe('confirming a corrected mapping', () => {
  it("carries the reviewer's added charity number into the canonical input", () => {
    // The actual reported bug: the model missed the charity number, a reviewer mapped
    // it, pressed Confirm, and the application kept its NULL — leaving due diligence
    // permanently unable to run however many times it was re-run.
    const before = canonicalFor(AI_MAPPING)
    expect(before.success).toBe(true)
    expect(before.success && before.data.charityNumber).toBeUndefined()

    const after = canonicalFor({ ...AI_MAPPING, charityNumber: 'Registered charity number' })
    expect(after.success).toBe(true)
    expect(after.success && after.data.charityNumber).toBe('1104903')
  })

  it('stops carrying the corrected field as an unmapped response', () => {
    // A field promoted out of `responses` into a typed column must leave `responses`,
    // or the application shows the same value twice and the "not captured" panel
    // disagrees with the column beside it.
    const after = canonicalFor({ ...AI_MAPPING, charityNumber: 'Registered charity number' })
    expect(after.success).toBe(true)
    const labels = after.success ? after.data.responses.map((r) => r.label) : []
    expect(labels).not.toContain('Registered charity number')
  })

  it('refuses an empty mapping rather than blanking a live application', () => {
    // The degenerate case worth guarding: the canonical registry not yet loaded in the
    // admin client would post `{}`. Confirm must fail on the required fields, not write
    // NULLs over an application that already exists.
    const empty = canonicalFor({})
    expect(empty.success).toBe(false)
  })

  it('refuses a mapping that drops a required field', () => {
    const { bankSortCode: _dropped, ...withoutSortCode } = AI_MAPPING
    expect(canonicalFor(withoutSortCode).success).toBe(false)
  })
})

// ─── Typed values ────────────────────────────────────────────────────────────
//
// The Arete case: one form question — "Where are you based and where do you help?" —
// answered with a 500-word paragraph naming the applicant's office AND the places the
// grant would serve. It maps to `deliveryArea` correctly and then fails validation at
// 255 characters, so the submission is held over a field the foundation never asked
// for separately. Nothing in the grid could supply the place name, because a mapping
// only ever points at an incoming field.

const PROSE =
  "WizeUp's North West operations are coordinated by our regional team based in " +
  'Stockport. From this base, we directly support schools and colleges across Greater ' +
  'Manchester, Stockport, Chorley, and surrounding areas. As a registered charity, ' +
  'WizeUp delivers workshops across England, but our North West strategy is driven ' +
  'locally. Funding will expand delivery westwards into Liverpool and Merseyside.'

const PROSE_PAYLOAD = { ...PAYLOAD, 'Where are you based and where do you help?': PROSE }
const PROSE_MAPPING = {
  ...AI_MAPPING,
  deliveryArea: 'Where are you based and where do you help?',
}

function canonicalWith(
  payload: Record<string, unknown>,
  mapping: Record<string, string>,
  values: Record<string, string> = {},
) {
  const resolved = resolvedFromMapping(payload, mapping, values)
  const responses = computeResponses(payload, resolved)
  return {
    resolved,
    parsed: CreateApplicationSchema.safeParse(
      buildCanonicalInput(ROUND_PROGRAMME_ID, resolved, responses),
    ),
  }
}

describe('a value the reviewer types instead of mapping', () => {
  it('is what holds the submission in the first place', () => {
    // Guards the premise: without a typed value there is no way through, because the
    // only field carrying the answer is too long for the column.
    const { parsed } = canonicalWith(PROSE_PAYLOAD, PROSE_MAPPING)
    expect(parsed.success).toBe(false)
    expect(
      !parsed.success && parsed.error.issues.some((i) => i.path.join('.') === 'deliveryArea'),
    ).toBe(true)
  })

  it('wins over the mapped field and lets the submission through', () => {
    const { parsed } = canonicalWith(PROSE_PAYLOAD, PROSE_MAPPING, {
      deliveryArea: 'Greater Manchester',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.deliveryArea).toBe('Greater Manchester')
  })

  it("keeps the applicant's own answer as a response rather than dropping it", () => {
    // The rule the canonical tiers exist to protect: a lost field must never be
    // indistinguishable from a question the foundation never asked. The reviewer
    // supplies a usable place name; what the applicant actually wrote still shows.
    const { parsed } = canonicalWith(PROSE_PAYLOAD, PROSE_MAPPING, {
      deliveryArea: 'Greater Manchester',
    })
    expect(parsed.success).toBe(true)
    const response =
      parsed.success &&
      parsed.data.responses.find((r) => r.label === 'Where are you based and where do you help?')
    expect(response && response.value).toBe(PROSE)
  })

  it("is never written to the foundation's lookup table", () => {
    // A lookup maps an incoming FIELD NAME to a canonical field. A typed value has no
    // field name, so storing one would put a phantom "(provided)" field in the table
    // and teach the next submission nothing.
    const { resolved } = canonicalWith(PROSE_PAYLOAD, PROSE_MAPPING, {
      deliveryArea: 'Greater Manchester',
    })
    expect(resolved.deliveryArea?.sourceKey).toBe(PROVIDED)
    expect(Object.keys(resolvedMapFor(resolved))).not.toContain(PROVIDED)
    expect(resolvedMapFor(resolved).deliveryArea).toBeUndefined()
  })

  it('ignores a blank one rather than storing an empty string', () => {
    const { resolved } = canonicalWith(PROSE_PAYLOAD, AI_MAPPING, { deliveryArea: '   ' })
    expect(resolved.deliveryArea).toBeUndefined()
    expect(providedValuesFor({ deliveryArea: '   ' })).toEqual({})
  })

  it('stores only trimmed values for real canonical fields', () => {
    // What goes in `provided_values`, and therefore what a later Confirm sends back.
    // A key that is not a canonical field would survive into the column and quietly
    // reappear as an input on every future review.
    expect(providedValuesFor({ deliveryArea: '  Ashton-under-Lyne ', notAField: 'x' })).toEqual({
      deliveryArea: 'Ashton-under-Lyne',
    })
  })
})

describe('a question long enough to be a paragraph', () => {
  // Arete's form ends by asking the applicant to agree to a 549-character declaration,
  // and Typeform sends the whole thing as the question's title. `responses` accepts it
  // — its label is uncapped — but `submittedFields` capped labels at 500, so the index
  // built from the SAME payload keys in the same breath refused the application. Eight
  // of their thirteen live submissions could not be re-confirmed, and any new one
  // carrying the declaration would have been held in the review queue over a length
  // nothing on screen could show anybody. The index's cap must never be the tighter of
  // the two.
  const DECLARATION = `By submitting this application I confirm that I am authorised to make this submission and sign this declaration. ${'x'.repeat(436)}`

  it('accepts a 549-character question in both the index and the responses', () => {
    expect(DECLARATION.length).toBe(549)
    const payload = { ...PAYLOAD, [DECLARATION]: 'I agree' }
    const resolved = resolvedFromMapping(payload, AI_MAPPING)
    const parsed = CreateApplicationSchema.safeParse(
      buildCanonicalInput(
        ROUND_PROGRAMME_ID,
        resolved,
        computeResponses(payload, resolved),
        buildSubmittedFields(payload, resolved),
      ),
    )
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.submittedFields?.map((f) => f.label)).toContain(
      DECLARATION,
    )
    expect(parsed.success && parsed.data.responses.map((r) => r.label)).toContain(DECLARATION)
  })
})
