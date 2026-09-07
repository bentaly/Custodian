// ─── Assembling an award letter from a grant ────────────────────────────────────
//
// Pure: takes the facts of an award and produces the text and HTML that get stored and
// emailed. Kept out of `src/server` so the set-up screen can render an identical
// preview in the browser before anything is written — what the admin approves is
// literally what the renderer will store.

import { fmtDate, fmtMoney } from '../format'
import { letterHtml } from '../letterHtml'
import {
  DEFAULT_AWARD_LETTER_SUBJECT,
  DEFAULT_AWARD_LETTER_TEMPLATE,
  DEFAULT_GRANT_CONDITIONS,
  renderAwardLetterBody,
  renderTemplate,
  type AwardLetterVars,
} from './template'

/** The grant facts a letter is rendered from. */
export type AwardLetterInput = {
  organisationName: string
  foundationName: string
  amountAwarded: number
  purpose: string | null
  /** ISO yyyy-mm-dd. */
  startDate: string | null
  programmeName: string | null
  roundName: string | null
  reference: string | null
  instalments: Array<{ amount: number; dueDate: string | null }>
  reporting: Array<{ label: string; dueDate: string }>
  signatory: string | null
  /** Issue date; defaults to today. Passed in so previews are stable in tests. */
  issuedAt?: Date
}

/** The foundation's letter configuration, with nulls meaning "use the built-in". */
export type AwardLetterSettings = {
  template: string | null
  conditions: string[] | null
  signatory: string | null
}

/** Resolve a foundation's overrides against the built-in defaults. */
export function resolveLetterSettings(settings: Partial<AwardLetterSettings> | null | undefined) {
  return {
    template: settings?.template ?? DEFAULT_AWARD_LETTER_TEMPLATE,
    conditions: settings?.conditions ?? DEFAULT_GRANT_CONDITIONS,
    signatory: settings?.signatory ?? null,
  }
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
]

/** "a single payment" / "two instalments" — the prose form used mid-sentence. */
export function paymentSummary(count: number): string {
  if (count <= 1) return 'a single payment'
  const word = NUMBER_WORDS[count] ?? String(count)
  return `${word} instalments`
}

function scheduleBlock(instalments: AwardLetterInput['instalments']): string {
  if (instalments.length === 0) return 'The payment schedule will be confirmed separately.'
  return instalments
    .map(
      (i, idx) =>
        `${idx + 1}. ${fmtMoney(i.amount)} — ${i.dueDate ? fmtDate(i.dueDate) : 'date to be confirmed'}`,
    )
    .join('\n')
}

function reportingBlock(reporting: AwardLetterInput['reporting']): string {
  // Never left blank: a template that says "we ask for reports on the following dates"
  // followed by nothing reads as a mistake, so say plainly that there are none.
  if (reporting.length === 0) return 'No formal reporting milestones have been set for this grant.'
  return reporting.map((r) => `${r.label} — ${fmtDate(r.dueDate)}`).join('\n')
}

/** Build the token values for a grant. Exported so the Settings preview can reuse it. */
export function awardLetterVars(input: AwardLetterInput): AwardLetterVars {
  return {
    organisationName: input.organisationName,
    foundationName: input.foundationName,
    amount: fmtMoney(input.amountAwarded),
    purpose: input.purpose ?? '',
    startDate: input.startDate ? fmtDate(input.startDate) : '',
    programmeName: input.programmeName ?? '',
    roundName: input.roundName ?? '',
    reference: input.reference ?? '',
    paymentSummary: paymentSummary(input.instalments.length),
    paymentSchedule: scheduleBlock(input.instalments),
    reportingSchedule: reportingBlock(input.reporting),
    // Deliberately NOT falling back to the foundation name: the default template signs
    // off with the signatory above the foundation, so a fallback prints the same name
    // twice and reads as a bug. Empty is legitimate here (see OPTIONAL_TOKENS), so the
    // line collapses away and the sign-off is just the foundation.
    signatory: input.signatory ?? '',
    today: fmtDate(input.issuedAt ?? new Date()),
  }
}

export type RenderedAwardLetter = {
  subject: string
  bodyText: string
  bodyHtml: string
  /** The conditions actually applied, in order — stored alongside the body. */
  conditions: string[]
}

/**
 * Render one award's letter: subject, plain text and HTML.
 *
 * `specialCondition` holds the grant-specific terms captured during set-up, one per
 * line: set-up lets an admin add several, and they are stored in the award's single
 * `special_condition` column rather than a table of their own. Each line becomes its own
 * clause appended to the standard list, so they number continuously with them — a
 * grantee reading "condition 10" should find one condition, not two competing lists,
 * and three bespoke terms should read as three rather than as one long paragraph.
 */
export function renderAwardLetter({
  input,
  settings,
  specialCondition,
  subjectTemplate = DEFAULT_AWARD_LETTER_SUBJECT,
}: {
  input: AwardLetterInput
  settings: Partial<AwardLetterSettings> | null | undefined
  specialCondition?: string | null
  subjectTemplate?: string
}): RenderedAwardLetter {
  const resolved = resolveLetterSettings(settings)
  const vars = awardLetterVars({ ...input, signatory: input.signatory ?? resolved.signatory })
  const conditions = [...resolved.conditions]
  for (const line of (specialCondition ?? '').split('\n')) {
    if (line.trim()) conditions.push(line.trim())
  }

  const bodyText = renderAwardLetterBody({ template: resolved.template, conditions, vars })
  return {
    subject: renderTemplate(subjectTemplate, vars),
    bodyText,
    bodyHtml: letterHtml(bodyText),
    conditions,
  }
}

/**
 * Wrap the rendered plain text as the HTML actually emailed.
 *
 * The rule and the markup are shared with every other letter Custodian sends — see
 * `src/lib/letterHtml.ts`. Kept exported under this name because it is the award
 * letter's HTML at every call site that already uses it.
 */
export const awardLetterHtml = letterHtml
