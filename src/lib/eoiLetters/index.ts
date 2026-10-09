// ─── The two letters an expression of interest can lead to ──────────────────────
//
// An EOI ends in one of two letters: "we cannot take you further" or "please make a
// full application". Both are a foundation's words to a third party, so both follow the
// award and decline letters' rules (`src/lib/awardLetter`): plain text with blank-line
// paragraphs and `{{token}}` placeholders, no markup, NULL in the database meaning "use
// Custodian's standard letter". The default wording is the foundation's own, agreed on
// the Notion page "Future things to discuss (Post Canada)", 2026-10-06.
//
// They are sent differently, and that is deliberate:
//
//   · The DECLINE is a batch, sent from the EOI list when the foundation is ready, like
//     the decline letters at the end of a round. Declining an EOI emails nobody: the
//     status change and the letter to a third party are never the same click.
//   · The INVITATION is one email, written in the dialog that sends it. This template
//     is its starting text, which the admin can still edit, and the server adds the
//     link to their form beneath it (`sourcing/outreach.ts`).
//
// Pure, so the Settings preview, the batch dialog's preview and the stored letter are
// all produced by the same code.

import { fmtDate } from '../format'
import { letterHtml, type LetterLogo } from '../letterHtml'
import { renderTemplate, type AwardLetterToken, type AwardLetterVars } from '../awardLetter'

/** The placeholders both EOI letters understand. Rendered as the Settings documentation. */
export const EOI_LETTER_TOKENS: AwardLetterToken[] = [
  { name: 'organisationName', description: 'Who sent the expression of interest' },
  { name: 'foundationName', description: 'Your foundation’s name' },
  { name: 'programmeName', description: 'The programme the expression of interest is filed under' },
  {
    name: 'signatory',
    description:
      'Who the letter is signed by: the decline letter’s signatory, else the award letter’s. Left out if neither is set.',
  },
  { name: 'today', description: 'The date the letter is sent' },
]

export const DEFAULT_EOI_DECLINE_TEMPLATE = `Dear {{organisationName}},

Thank you for your expression of interest to {{foundationName}}.

On behalf of the trustee board, I am sorry to say that we cannot progress you to our application stage on this occasion.

We wish you every success with the project, and with the work you do.

Yours sincerely,

{{signatory}}
{{foundationName}}`

export const DEFAULT_EOI_DECLINE_SUBJECT = 'Your expression of interest to {{foundationName}}'

export const DEFAULT_EOI_INVITE_TEMPLATE = `Dear {{organisationName}},

Thank you for your expression of interest. We would like to invite you to submit a full application for {{programmeName}}.

The link below takes you to the application form.

Yours sincerely,

{{signatory}}
{{foundationName}}`

export const DEFAULT_EOI_INVITE_SUBJECT = 'An invitation to apply to {{foundationName}}'

/** A foundation's overrides, as stored. NULL = the standard letter. */
export type EoiLetterSettings = {
  declineTemplate: string | null
  inviteTemplate: string | null
}

export type EoiLetterInput = {
  organisationName: string
  foundationName: string
  programmeName: string | null
  /** Already resolved: the decline letter's signatory, else the award letter's. */
  signatory: string | null
  issuedAt?: Date
}

function vars(input: EoiLetterInput): AwardLetterVars {
  return {
    organisationName: input.organisationName,
    foundationName: input.foundationName,
    programmeName: input.programmeName ?? '',
    // Empty is legitimate: the line collapses and the letter signs off as the foundation.
    signatory: input.signatory ?? '',
    today: fmtDate(input.issuedAt ?? new Date()),
  }
}

export type RenderedEoiLetter = { subject: string; bodyText: string; bodyHtml: string }

/** The decline letter, ready to store: subject, plain text and HTML. */
export function renderEoiDecline(
  input: EoiLetterInput,
  template: string | null | undefined,
  logo?: LetterLogo | null,
): RenderedEoiLetter {
  const v = vars(input)
  const bodyText = renderTemplate(template ?? DEFAULT_EOI_DECLINE_TEMPLATE, v)
  return {
    subject: renderTemplate(DEFAULT_EOI_DECLINE_SUBJECT, v),
    bodyText,
    bodyHtml: letterHtml(bodyText, logo),
  }
}

/**
 * The invitation's starting text. Text only: the dialog shows it for editing and the
 * server turns what was sent into HTML with the link (`renderOutreach`).
 */
export function renderEoiInvite(
  input: EoiLetterInput,
  template: string | null | undefined,
): { subject: string; body: string } {
  const v = vars(input)
  return {
    subject: renderTemplate(DEFAULT_EOI_INVITE_SUBJECT, v),
    body: renderTemplate(template ?? DEFAULT_EOI_INVITE_TEMPLATE, v),
  }
}

/** Text matching the standard letter is stored as NULL, so it keeps tracking the default. */
export function storedTemplate(text: string, standard: string): string | null {
  return !text.trim() || text.trim() === standard.trim() ? null : text
}
