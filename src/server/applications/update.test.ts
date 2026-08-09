import { describe, expect, it } from 'vitest'
import { CreateApplicationSchema } from '../../lib/validators/application'
import { resolvedFromMapping, computeResponses, buildCanonicalInput } from '../fieldMapping/assemble'

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
