// ─── The decline letter: default template and tokens ────────────────────────────
//
// The letter a foundation sends an applicant it is not going to fund. Its twin is the
// award letter (`src/lib/awardLetter`), and it deliberately shares that module's rules:
// plain text with blank-line paragraphs and `{{token}}` placeholders, no loops, no
// conditionals, no markup passthrough. A foundation admin is writing a letter, not a
// program, and this one goes to third parties who did NOT get the grant — the audience
// least inclined to give anyone the benefit of the doubt about a stray `[not set]`.
//
// What it does NOT have is conditions of grant: there is no grant. That is the only
// structural difference between the two letters, and it is why this is its own module
// rather than a flag on the award letter's.

import { renderTemplate, type AwardLetterToken, type AwardLetterVars } from '../awardLetter'

/** One placeholder a foundation may use in their decline template. */
export type DeclineLetterToken = AwardLetterToken

/**
 * Every token the decline renderer understands. As with the award letter, this list IS
 * the documentation rendered on the Settings screen, so the two cannot drift.
 *
 * Notably absent: `amount`. The award letter states what was given; a decline letter
 * quoting the sum an applicant asked for and did not receive reads as a rebuke, and
 * every foundation asked for it to go. `amountRequested` is available for the rare
 * house style that acknowledges the ask, but it is not in the default letter.
 */
export const DECLINE_LETTER_TOKENS: DeclineLetterToken[] = [
  {
    name: 'organisationName',
    description: 'The applicant organisation, e.g. Pennine Youth Alliance',
  },
  { name: 'foundationName', description: 'Your foundation’s name' },
  { name: 'programmeName', description: 'The programme they applied to' },
  { name: 'roundName', description: 'The funding round they applied in' },
  { name: 'reference', description: 'Their application reference' },
  { name: 'amountRequested', description: 'The amount they asked for, e.g. £35,000' },
  {
    name: 'signatory',
    description:
      'Who the letter is signed by, from your settings. Left out if you have not set one.',
  },
  { name: 'today', description: 'The date the letter is sent' },
]

/**
 * The letter Custodian sends when a foundation has not written its own.
 *
 * Written to be sendable unedited by a foundation that never opens the settings screen,
 * which sets the bar: it must say no clearly on the first line (a decline that takes
 * three paragraphs to arrive is crueller, not kinder), give the one piece of
 * information the reader actually needs — that the decision is about capacity, not a
 * judgement of their work — and promise nothing the foundation has not agreed to. In
 * particular it does NOT offer feedback, invite a call, or encourage reapplication:
 * every one of those is a commitment somebody in the foundation then has to keep, and a
 * default template must not sign them up to it. A foundation that wants to offer any of
 * them can say so in their own version.
 */
export const DEFAULT_DECLINE_LETTER_TEMPLATE = `Dear {{organisationName}},

Thank you for your application to {{foundationName}}.

On behalf of the trustee board, I am sorry to say that we cannot fund your application on this occasion.

We wish you every success with the project, and with the work you do.

Yours sincerely,

{{signatory}}
{{foundationName}}`

/** Subject line of the decline email. Supports the same tokens. */
export const DEFAULT_DECLINE_LETTER_SUBJECT = 'Your application to {{foundationName}}'

/** The foundation's decline-letter configuration; null means "use the built-in". */
export type DeclineLetterSettings = {
  template: string | null
  signatory: string | null
}

/**
 * Resolve a foundation's overrides against the built-ins.
 *
 * `signatory` falls back to the AWARD letter's signatory rather than to nothing. It is
 * the same person signing on behalf of the same trustees, and a foundation that has
 * already told us who signs their letters should not have to say it twice — a second
 * blank field is how the two come to disagree, and "your award letters are signed and
 * your decline letters are not" is a difference an applicant can see.
 */
export function resolveDeclineSettings(
  settings: Partial<DeclineLetterSettings> | null | undefined,
  awardSignatory?: string | null,
) {
  return {
    template: settings?.template ?? DEFAULT_DECLINE_LETTER_TEMPLATE,
    signatory: settings?.signatory ?? awardSignatory ?? null,
  }
}

/** Substitute the `{{token}}` placeholders — the award letter's renderer, unchanged. */
export function renderDeclineLetterBody(template: string, vars: AwardLetterVars): string {
  return renderTemplate(template, vars)
}
