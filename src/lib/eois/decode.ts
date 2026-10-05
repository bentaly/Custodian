// ─── Reading an expression of interest ───────────────────────────────────────
//
// An EOI arrives the way an application does: a flat object of the foundation's own
// field names. It is read far more lightly, and the difference is the design.
//
// An application is held when a required field cannot be found, because an application
// that is missing its programme cannot be scored, shortlisted or paid. An EOI gates
// nothing. It is a letter of introduction: what a grants officer needs is to READ it, and
// a row that sat in a review queue because its form called the charity number
// "Registration no." would defeat the point of a lighter first stage. So nothing here can
// fail. Whatever is recognised goes on a column, everything that was sent is kept as an
// answer in the order it was asked, and an EOI we cannot place in a programme has no
// programme until somebody picks one on the screen.
//
// Recognition is exact-match only, from the two sources the application pipeline already
// trusts without review: the foundation's own taught mappings (`field_mappings`) and the
// curated common dictionary. There is no AI fallback, deliberately: it is what makes an
// application's ingest take seconds and cost money, and an unrecognised answer loses
// nothing here because it is still on the page.
//
// Pure: no database, no network. `receiveEoi` does the IO around it.

import {
  applyLookup,
  coerceAmount,
  matchCommonKey,
  normaliseKey,
  toStringValue,
} from '../fieldMapping'
import type { FieldMappingEntry } from '../fieldMapping'
import { findInviteRef, inviteRefKey, type InviteRef } from '../sourcing/inviteRef'

export type EoiProgramme = { id: string; name: string; acceptsEois?: boolean }

export type DecodedEoi = {
  organisationName: string | null
  reference: string | null
  contactEmail: string | null
  charityNumber: string | null
  companyNumber: string | null
  amountIndicative: number | null
  programmeId: string | null
  inviteRef: InviteRef | null
  responses: Array<{ label: string; value: string }>
}

/** What a form calls the question "which programme is this for". Compared normalised. */
/**
 * A question asking how much. EOI forms ask it loosely ("Roughly how much would you ask
 * for?") and the dictionary's aliases are exact phrases, so an EOI also reads any
 * question naming an amount. Safe here and not on an application, because the figure
 * gates nothing: it is printed as "indicative" and summed nowhere.
 */
const AMOUNT_QUESTION = /\b(how much|amount|funding|grant size|budget)\b/i

/** An answer that is exactly one email address and nothing else. */
const LONE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const PROGRAMME_KEYS = new Set(
  ['programme', 'programme name', 'program', 'fund', 'fund name', 'grant programme'].map(
    normaliseKey,
  ),
)

/**
 * Which programme an EOI is for, or null when it cannot be said without guessing.
 *
 * In order: an answer that IS a programme's name; a form whose title contains exactly one
 * programme's name ("Youth Fund: expression of interest"); and, when exactly one programme
 * takes EOIs (or the foundation runs only one), that one. A title naming two programmes, or two programmes and no
 * answer, is null: a wrong programme files the EOI where nobody looking for it will look,
 * and "no programme" is a state the screen shows and fixes.
 */
export function pickEoiProgramme(
  answers: string[],
  formName: string | null,
  programmes: EoiProgramme[],
): string | null {
  const byName = new Map(programmes.map((p) => [normaliseKey(p.name), p.id]))
  for (const answer of answers) {
    const hit = byName.get(normaliseKey(answer))
    if (hit) return hit
  }
  if (formName) {
    const title = ` ${normaliseKey(formName)} `
    const named = programmes.filter((p) => {
      const name = normaliseKey(p.name)
      return name !== '' && title.includes(` ${name} `)
    })
    if (named.length === 1) return named[0]!.id
  }
  const takingEois = programmes.filter((p) => p.acceptsEois)
  if (takingEois.length === 1) return takingEois[0]!.id
  return programmes.length === 1 ? programmes[0]!.id : null
}

export function decodeEoi(
  payload: Record<string, unknown>,
  /** The sender's order. Captured before the payload becomes jsonb, which reorders keys. */
  fieldOrder: string[],
  mappings: FieldMappingEntry[],
  programmes: EoiProgramme[],
): DecodedEoi {
  // The foundation's own mappings first, then the common dictionary for whatever is
  // left: the same precedence as an application, so a client can override an alias.
  const lookup = applyLookup(payload, mappings)
  const resolved: Record<string, string> = {}
  for (const [canonical, r] of Object.entries(lookup.resolved)) {
    if (r) resolved[canonical] = r.value
  }
  for (const key of lookup.leftoverKeys) {
    const canonical = matchCommonKey(key)
    if (!canonical || resolved[canonical]) continue
    const value = toStringValue(payload[key])
    if (value) resolved[canonical] = value
  }

  const programmeAnswers = [
    resolved['programmeName'],
    ...Object.keys(payload)
      .filter((k) => PROGRAMME_KEYS.has(normaliseKey(k)))
      .map((k) => toStringValue(payload[k])),
  ].filter((v): v is string => !!v)

  // Two fallbacks the application pipeline leaves to its AI mapper, which an EOI does
  // not have. The contact email is the one answer that is an email address, when there
  // is exactly one (two could be the organisation's and a referee's). The amount is a
  // question about money. Neither ever overrides a field already resolved above.
  const emails = fieldOrder.filter((k) => LONE_EMAIL.test(toStringValue(payload[k])))
  if (!resolved['applicantEmail'] && emails.length === 1) {
    resolved['applicantEmail'] = toStringValue(payload[emails[0]!])
  }
  if (!resolved['amountRequested']) {
    const asked = fieldOrder.find(
      (k) => AMOUNT_QUESTION.test(k) && coerceAmount(toStringValue(payload[k])) !== '',
    )
    if (asked) resolved['amountRequested'] = toStringValue(payload[asked])
  }

  // Read strictly, like every amount in the app: one number or nothing. "Between £5k
  // and £10k" stays an answer on the page rather than becoming a figure nobody wrote.
  const amount = resolved['amountRequested'] ? coerceAmount(resolved['amountRequested']) : ''

  const refKey = inviteRefKey(payload)
  const responses = fieldOrder
    .filter((k) => k in payload && k !== refKey)
    .map((k) => ({ label: k, value: toStringValue(payload[k]) }))
    .filter((r) => r.value !== '')

  return {
    organisationName: resolved['organisationName'] ?? null,
    reference: resolved['externalApplicationId'] ?? null,
    contactEmail: resolved['applicantEmail'] ?? null,
    charityNumber: resolved['charityNumber'] ?? null,
    companyNumber: resolved['companyNumber'] ?? null,
    amountIndicative: amount ? Number(amount) : null,
    programmeId: pickEoiProgramme(
      programmeAnswers,
      toStringValue(payload['Form name']) || null,
      programmes,
    ),
    inviteRef: findInviteRef(payload),
    responses,
  }
}

/**
 * The answer that says what the grant would be FOR, when the form asked. EOI forms ask it
 * in many words ("What would you like funding for?", "Purpose of the grant") and many do
 * not ask at all, so this is a suggestion to prefill, never a column: the person taking
 * the EOI to the shortlist reads it and can rewrite it. Null when no question fits.
 */
const PURPOSE_QUESTION =
  /\b(purpose|funding for|grant for|money for|grant be used|use the (grant|funding|money)|what would you like to do)\b/i

export function purposeAnswer(responses: Array<{ label: string; value: string }>): string | null {
  return (
    responses.find((r) => PURPOSE_QUESTION.test(r.label) && r.value.trim())?.value.trim() ?? null
  )
}
