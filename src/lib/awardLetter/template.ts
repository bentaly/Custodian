// ─── The award letter: default template, tokens and renderer ────────────────────
//
// An award letter is the document a foundation sends a charity to say "you have the
// grant, and here are the terms". Custodian ships a sensible default; a foundation can
// override it wholesale in Settings → Award letter.
//
// The template is plain text with blank-line paragraphs and `{{token}}` placeholders.
// It is deliberately NOT a general-purpose templating language — no loops, no
// conditionals, no expressions. A foundation admin is writing a letter, not a program,
// and every escape hatch is also a way to render something the sender never reviewed.
// The block-shaped values (payment schedule, reporting schedule, conditions) are
// pre-rendered by the caller and dropped in as text.

/** One placeholder a foundation may use in their template. */
export type AwardLetterToken = {
  /** The token name, without braces. */
  name: string
  /** What it resolves to, shown in the Settings reference table. */
  description: string
}

/**
 * Every token the renderer understands. This list IS the documentation rendered on the
 * Settings screen, so the two can never drift — the same reason `/settings/submissions`
 * renders the canonical field registries rather than restating them.
 */
export const AWARD_LETTER_TOKENS: AwardLetterToken[] = [
  {
    name: 'organisationName',
    description: 'The grantee organisation, e.g. Pennine Youth Alliance',
  },
  { name: 'foundationName', description: 'Your foundation’s name' },
  { name: 'amount', description: 'The amount awarded, e.g. £35,000' },
  { name: 'purpose', description: 'The grant purpose you set during set-up' },
  { name: 'startDate', description: 'The date the grant period begins, e.g. 1 Aug 2026' },
  { name: 'programmeName', description: 'The programme the grant sits in' },
  { name: 'roundName', description: 'The funding round the application came through' },
  { name: 'reference', description: 'The application reference' },
  {
    name: 'paymentSummary',
    description: 'One line describing the payment structure, e.g. “two instalments”',
  },
  { name: 'paymentSchedule', description: 'The full instalment schedule, as a list' },
  { name: 'reportingSchedule', description: 'The reporting milestones and their dates, as a list' },
  {
    name: 'conditions',
    description:
      'The numbered conditions of grant. If you leave this token out, the conditions are added at the end instead.',
  },
  {
    name: 'signatory',
    description:
      'Who the letter is signed by, from your settings. Left out if you have not set one.',
  },
  { name: 'today', description: 'The date the letter is issued' },
]

/**
 * The letter Custodian sends when a foundation has not written their own. Kept
 * deliberately plain and complete: a foundation that never opens the settings screen
 * still sends something a trustee would be happy to put their name to.
 *
 * `{{purpose}}` sits in its own block rather than inline after "towards". It is the
 * clause conditions 1, 2 and 5 all bind to ("the agreed purpose"), so it is worth
 * setting out where it can be quoted; a purpose written as a standalone sentence is
 * also the same text the shortlist card and application screen show, so there is no
 * second grammatical form to keep in step. Foundations on their own template are
 * unaffected, and stored letters are snapshots — nothing already sent is rewritten.
 */
export const DEFAULT_AWARD_LETTER_TEMPLATE = `Dear {{organisationName}},

I am pleased to confirm that the trustees of {{foundationName}} have approved a grant of {{amount}}. The grant is made towards the following purpose:

{{purpose}}

The grant period begins on {{startDate}} and the money is paid by bank transfer in {{paymentSummary}}:

{{paymentSchedule}}

We ask for reports on the following dates:

{{reportingSchedule}}

The grant is made subject to the conditions set out below. Please confirm your acceptance of them by replying to this email.

{{conditions}}

We look forward to hearing how the work progresses.

Yours sincerely,

{{signatory}}
{{foundationName}}`

/**
 * The standard conditions of grant attached to every award unless a foundation edits
 * them. Each begins with a short bold-able lead sentence so the rendered list scans.
 */
export const DEFAULT_GRANT_CONDITIONS: string[] = [
  'Use of funds. The grant must be used only for the agreed purpose. Any proposed change to the use of funds, project scope, timetable, or key personnel must be agreed with us in writing in advance.',
  'Restricted funding. These funds are restricted to the project described and must be held and accounted for separately from your general funds.',
  'Reporting. You agree to provide progress and financial reports in line with the reporting schedule. Grant payments after the first may be conditional on receipt and approval of satisfactory reports.',
  'Financial records. You must keep accurate financial records relating to the grant and make them available to us on request.',
  'Unspent funds. Any grant funds unspent at the end of the grant period, or not used for the agreed purpose, must be returned to us unless we agree otherwise in writing.',
  'Acknowledgement. Please acknowledge our support in relevant published materials, in a manner to be agreed.',
  'Safeguarding and governance. You confirm that you have appropriate safeguarding, equality, and financial governance policies in place, proportionate to your organisation and the activities funded.',
  'Notification of difficulties. You must notify us promptly of any event that materially threatens delivery of the project or that could bring the project into disrepute.',
  'Withdrawal. We reserve the right to suspend or withdraw the grant, and to require repayment, if any condition is not met or if the funds are not used as agreed.',
]

/** Subject line of the award notification email. Supports the same tokens. */
export const DEFAULT_AWARD_LETTER_SUBJECT = 'Your grant from {{foundationName}}'

/** The values a template is rendered against. Every token resolves to a string. */
export type AwardLetterVars = Record<string, string>

/** Shown in place of a token whose value is missing, so a gap is obvious in preview. */
export const MISSING_TOKEN_PLACEHOLDER = '[not set]'

/**
 * Tokens whose empty value is a real answer rather than an omission. A foundation that
 * attaches no standard conditions has *chosen* that; rendering "[not set]" there would
 * be a lie. `signatory` is the same: plenty of foundations sign in the foundation's own
 * name and never fill the field in, and the line collapsing away leaves a sign-off that
 * reads correctly. Every other token is required, and blank means somebody forgot.
 */
const OPTIONAL_TOKENS = new Set(['conditions', 'signatory'])

/**
 * Substitute `{{token}}` placeholders. Unknown tokens are left alone rather than
 * blanked: a typo like `{{orgName}}` disappearing silently would ship a letter with a
 * hole in it, whereas leaving the braces visible makes the mistake obvious in the
 * preview the sender is looking at. Known-but-empty values render the placeholder,
 * unless the token is one where empty is legitimate.
 */
export function renderTemplate(template: string, vars: AwardLetterVars): string {
  const body = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
    if (!(name in vars)) return whole
    const value = vars[name]
    if (value && value.trim()) return value
    return OPTIONAL_TOKENS.has(name) ? '' : MISSING_TOKEN_PLACEHOLDER
  })
  // Collapse the runs of blank lines left behind when a block token (an empty
  // reporting schedule, say) resolves to nothing, so the letter doesn't gape.
  return body.replace(/\n{3,}/g, '\n\n').trim()
}

/** Render the conditions as the numbered block the letter embeds. */
export function renderConditions(conditions: string[]): string {
  if (conditions.length === 0) return ''
  return ['Conditions of grant', '', ...conditions.map((c, i) => `${i + 1}. ${c}`)].join('\n')
}

/**
 * Render a full letter body.
 *
 * `{{conditions}}` is optional in a template: a foundation rewriting the letter should
 * not have to remember it, and a letter that quietly lost its conditions would be a
 * contractual problem rather than a cosmetic one. So when the template omits the token,
 * the conditions block is appended instead of dropped.
 */
export function renderAwardLetterBody({
  template,
  conditions,
  vars,
}: {
  template: string
  conditions: string[]
  vars: AwardLetterVars
}): string {
  const conditionsBlock = renderConditions(conditions)
  const hasToken = /\{\{\s*conditions\s*\}\}/.test(template)
  const body = renderTemplate(template, { ...vars, conditions: hasToken ? conditionsBlock : '' })
  if (hasToken || !conditionsBlock) return body
  return `${body}\n\n${conditionsBlock}`
}
