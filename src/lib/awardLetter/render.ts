// ─── Assembling an award letter from a grant ────────────────────────────────────
//
// Pure: takes the facts of an award and produces the text and HTML that get stored and
// emailed. Kept out of `src/server` so the set-up screen can render an identical
// preview in the browser before anything is written — what the admin approves is
// literally what the renderer will store.

import { fmtDate, fmtMoney } from '../format'
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
    signatory: input.signatory ?? input.foundationName,
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
 * `specialCondition` is the grant-specific term captured during set-up; it is appended
 * to the standard list so it numbers continuously with them — a grantee reading
 * "condition 10" should find one condition, not two competing lists.
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
  if (specialCondition && specialCondition.trim()) conditions.push(specialCondition.trim())

  const bodyText = renderAwardLetterBody({ template: resolved.template, conditions, vars })
  return {
    subject: renderTemplate(subjectTemplate, vars),
    bodyText,
    bodyHtml: awardLetterHtml(bodyText),
    conditions,
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Wrap the rendered plain text as the HTML actually emailed.
 *
 * Everything is escaped and the markup is generated here — a foundation's template is
 * treated as text, never as HTML. Letting an admin paste markup into the template would
 * mean the app emails attacker-shaped HTML to third-party charities on the foundation's
 * behalf, which is a much worse failure than a letter that cannot be styled.
 *
 * Inline styles and a table-free layout, because email clients are email clients.
 */
export function awardLetterHtml(bodyText: string): string {
  const blocks = bodyText.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim())
    // A run of "1. …" lines is the numbered block a template dropped in (conditions or
    // the payment schedule); render it as a real ordered list rather than paragraphs.
    const numbered = lines.length > 1 && lines.every((l) => /^\d+\.\s/.test(l.trim()))
    if (numbered) {
      const items = lines
        .map(
          (l) =>
            `<li style="margin:0 0 8px;line-height:1.55;">${escapeHtml(l.trim().replace(/^\d+\.\s*/, ''))}</li>`,
        )
        .join('')
      // Literal hex, not tokens: this HTML is emailed (see lib/email.ts).
      return `<ol style="margin:0 0 16px;padding-left:20px;color:#344051;font-size:14px;">${items}</ol>`
    }
    if (lines.length > 1) {
      return `<p style="margin:0 0 16px;line-height:1.6;color:#344051;font-size:14px;">${lines
        .map((l) => escapeHtml(l.trim()))
        .join('<br />')}</p>`
    }
    return `<p style="margin:0 0 16px;line-height:1.6;color:#344051;font-size:14px;">${escapeHtml(
      (lines[0] ?? '').trim(),
    )}</p>`
  })

  return [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;color:#344051;">',
    blocks.join(''),
    '</div>',
  ].join('')
}
