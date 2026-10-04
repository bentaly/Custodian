// ─── Emails to an organisation that has not applied yet ──────────────────────
//
// Three of them, all written by a person in a dialog and sent on the foundation's
// behalf: a plain message, an invitation to send an expression of interest, and an
// invitation to apply. The last two carry a link to the foundation's OWN form with the
// invitation reference on it (`inviteRef.ts`).
//
// These are not letters in the award-letter sense. There is no template in Settings and
// no snapshot table: each is a short note an admin reads and edits before it goes, and
// what was sent is recorded in the partnership's history (or on the EOI). What this
// module supplies is the starting text, so nobody faces an empty box, and the one piece
// of markup: the link, which the server adds and the admin cannot mistype.
//
// Pure. Text only, escaped on the way to HTML: an admin's words are emailed to a third
// party under the foundation's name, the same reason a letter template is never markup.

import { escapeHtml } from '../html'
import { letterHtml } from '../letterHtml'

export const OUTREACH_KINDS = ['message', 'eoi_invite', 'apply_invite'] as const
export type OutreachKind = (typeof OUTREACH_KINDS)[number]

/** Does this kind of email carry a link to one of the foundation's forms? */
export function outreachNeedsLink(kind: OutreachKind): boolean {
  return kind !== 'message'
}

export const OUTREACH_LINK_LABEL: Record<Exclude<OutreachKind, 'message'>, string> = {
  eoi_invite: 'Send your expression of interest',
  apply_invite: 'Start your application',
}

export function defaultOutreach(
  kind: OutreachKind,
  ctx: {
    foundationName: string
    programmeName: string | null
    contactName: string | null
    senderName: string | null
  },
): { subject: string; body: string } {
  const hello = ctx.contactName?.trim() ? `Dear ${ctx.contactName.trim()},` : 'Hello,'
  const signOff = `Kind regards,\n${ctx.senderName?.trim() || ctx.foundationName}`
  const programme = ctx.programmeName ? ` to our ${ctx.programmeName} programme` : ''

  if (kind === 'eoi_invite') {
    return {
      subject: `An invitation from ${ctx.foundationName}`,
      body: [
        hello,
        `We would like to hear more about your work, and to invite you to send us a short expression of interest${programme}. It is a brief form, and it helps us understand whether a full application would be worth your time.`,
        'The link below takes you to it.',
        signOff,
      ].join('\n\n'),
    }
  }
  if (kind === 'apply_invite') {
    return {
      subject: `An invitation to apply to ${ctx.foundationName}`,
      body: [
        hello,
        `Thank you for telling us about your work. We would like to invite you to submit a full application${programme}.`,
        'The link below takes you to the application form.',
        signOff,
      ].join('\n\n'),
    }
  }
  return { subject: '', body: `${hello}\n\n\n\n${signOff}` }
}

/**
 * The email as sent: the admin's text, then the link on its own line. Returned as both
 * parts, because a client that shows plain text must still get an address it can open.
 */
export function renderOutreach(
  kind: OutreachKind,
  body: string,
  link: string | null,
): { text: string; html: string } {
  const text = body.trim()
  if (kind === 'message' || !link) return { text, html: letterHtml(text) }
  const label = OUTREACH_LINK_LABEL[kind]
  const anchor =
    `<p style="margin:0 0 16px;line-height:1.6;font-size:14px;">` +
    `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="color:#141C24;font-weight:600;">${escapeHtml(label)}</a>` +
    `</p>`
  // Inside the letter's own wrapper, so the link sits in the same column as the text.
  const html = letterHtml(text).replace(/<\/div>$/, `${anchor}</div>`)
  return { text: `${text}\n\n${label}:\n${link}`, html }
}
