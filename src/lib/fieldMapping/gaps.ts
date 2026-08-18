// ─── What a submission didn't capture ───────────────────────────────────────────
//
// A field that never mapped is invisible by construction: the typed column is simply
// null, exactly as it would be if the foundation had never asked the question. Nothing
// errors, nothing is queued, and the feature that depends on it just never runs. That
// is how an application reached an admin looking screened when due diligence had never
// been attempted — the charity number was in the payload the whole time, under a label
// the mapper didn't recognise.
//
// So the absence has to be stated. This turns the registry's `tier` + `degrades`
// metadata into a list an application screen can render: for each field that should be
// here and isn't, what stops working because of it.
//
// Pure, and deliberately takes plain values rather than a row type, so it can be used
// against an application, an ingest's resolved map, or a test fixture.

import {
  CANONICAL_FIELDS,
  CANONICAL_FIELD_BY_KEY,
  REQUIRED_ONE_OF_GROUPS,
  EXPECTED_ONE_OF_GROUPS,
  EXPECTED_GROUPED_KEYS,
  describeOneOfGroup,
  type CanonicalFieldKey,
} from './canonical'

export interface FieldGap {
  key: CanonicalFieldKey
  label: string
  /** What stops working without it, phrased for an admin reading the application. */
  degrades: string
}

export interface OneOfGap {
  keys: CanonicalFieldKey[]
  /** "charity number or company number" */
  label: string
  degrades: string
}

export interface FieldGaps {
  /**
   * `expected` fields with no value — the application exists, a feature is degraded.
   * Excludes members of an expected group, which are reported once via `expectedGroups`.
   */
  expected: FieldGap[]
  /**
   * Expected groups with no member set (see EXPECTED_ONE_OF_GROUPS). Reported as one
   * entry rather than per field: with a budget document attached, a separate "budget
   * breakdown not captured" line would be printing a complaint next to its own answer.
   */
  expectedGroups: OneOfGap[]
  /**
   * Required one-of groups with no member set — the pipeline holds these rather than
   * promoting, so a gap here means an application that predates the group (or one a
   * superadmin created directly). Empty in practice while REQUIRED_ONE_OF_GROUPS is:
   * the registration pair reports through `expectedGroups` now.
   */
  oneOf: OneOfGap[]
  /** True when anything at all is missing — the cheap check for "render the panel". */
  any: boolean
}

/** Empty string, empty array and null all count as "not captured". */
function isPresent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function fieldGaps(values: Partial<Record<CanonicalFieldKey, unknown>>): FieldGaps {
  const expected: FieldGap[] = CANONICAL_FIELDS.filter(
    (f) => f.tier === 'expected' && !EXPECTED_GROUPED_KEYS.has(f.key) && !isPresent(values[f.key]),
  ).map((f) => ({
    key: f.key,
    label: f.label,
    // Every `expected` field carries `degrades` in the registry; the fallback keeps
    // this total rather than rendering an empty line if one is ever added without it.
    degrades: f.degrades ?? 'Some of this application is missing as a result.',
  }))

  const expectedGroups: OneOfGap[] = EXPECTED_ONE_OF_GROUPS.filter(
    (group) => !group.keys.some((k) => isPresent(values[k])),
  ).map((group) => ({
    keys: group.keys,
    label: describeOneOfGroup(group.keys),
    degrades: group.degrades,
  }))

  const oneOf: OneOfGap[] = REQUIRED_ONE_OF_GROUPS.filter(
    (group) => !group.some((k) => isPresent(values[k])),
  ).map((group) => ({
    keys: group,
    label: describeOneOfGroup(group),
    degrades:
      'Without one of them there is no register to check, so this application cannot be screened for due diligence.',
  }))

  return {
    expected,
    expectedGroups,
    oneOf,
    any: expected.length > 0 || expectedGroups.length > 0 || oneOf.length > 0,
  }
}

/**
 * Whether the registration pair is entirely absent — the due diligence precondition,
 * and the reason the application screen says "not screened" rather than "not screened
 * YET". Reads both group buckets so it keeps answering the same question whichever
 * tier the pair sits in.
 */
export function missingRegistrationNumber(
  values: Partial<Record<CanonicalFieldKey, unknown>>,
): boolean {
  const gaps = fieldGaps(values)
  return [...gaps.oneOf, ...gaps.expectedGroups].some((g) => g.keys.includes('charityNumber'))
}

export { CANONICAL_FIELD_BY_KEY }
