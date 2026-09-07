// ─── Assembling a decline letter from an application ────────────────────────────
//
// Pure, and out of `src/server` for the same reason the award letter's renderer is:
// the dialog previews the letters in the browser before anything is written or sent,
// and what an admin approves has to be produced by the code that stores it.

import { fmtDate, fmtMoney } from '../format'
import { letterHtml } from '../letterHtml'
import { renderTemplate, type AwardLetterVars } from '../awardLetter'
import {
  DEFAULT_DECLINE_LETTER_SUBJECT,
  renderDeclineLetterBody,
  resolveDeclineSettings,
  type DeclineLetterSettings,
} from './template'

/** The application facts a decline letter is rendered from. */
export type DeclineLetterInput = {
  organisationName: string
  foundationName: string
  programmeName: string | null
  roundName: string | null
  reference: string | null
  amountRequested: number | null
  signatory: string | null
  /** Issue date; defaults to today. Passed in so previews are stable in tests. */
  issuedAt?: Date
}

/** Build the token values for one application. */
export function declineLetterVars(input: DeclineLetterInput): AwardLetterVars {
  return {
    organisationName: input.organisationName,
    foundationName: input.foundationName,
    programmeName: input.programmeName ?? '',
    roundName: input.roundName ?? '',
    reference: input.reference ?? '',
    amountRequested: input.amountRequested === null ? '' : fmtMoney(input.amountRequested),
    // Empty is legitimate (see the award letter's OPTIONAL_TOKENS): plenty of
    // foundations sign in the foundation's name alone, and the line collapses away.
    signatory: input.signatory ?? '',
    today: fmtDate(input.issuedAt ?? new Date()),
  }
}

export type RenderedDeclineLetter = {
  subject: string
  bodyText: string
  bodyHtml: string
}

/** Render one applicant's decline letter: subject, plain text and HTML. */
export function renderDeclineLetter({
  input,
  settings,
  awardSignatory,
  subjectTemplate = DEFAULT_DECLINE_LETTER_SUBJECT,
}: {
  input: DeclineLetterInput
  settings: Partial<DeclineLetterSettings> | null | undefined
  /** The award letter's signatory, used when the decline letter has none of its own. */
  awardSignatory?: string | null
  subjectTemplate?: string
}): RenderedDeclineLetter {
  const resolved = resolveDeclineSettings(settings, awardSignatory)
  const vars = declineLetterVars({ ...input, signatory: input.signatory ?? resolved.signatory })
  const bodyText = renderDeclineLetterBody(resolved.template, vars)
  return {
    subject: renderTemplate(subjectTemplate, vars),
    bodyText,
    bodyHtml: letterHtml(bodyText),
  }
}
