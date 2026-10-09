// ─── Plain text → the HTML we actually email ────────────────────────────────────
//
// Shared by every letter Custodian sends on a foundation's behalf (award, decline).
// It lives on its own because the rule it enforces is the same in both cases and must
// never be re-implemented per letter: the stored plain text is the source of truth, and
// the markup is generated HERE from it.
//
// Everything is escaped. A foundation's template is treated as text, never as HTML —
// letting an admin paste markup into a template would mean the app emails
// attacker-shaped HTML to third-party charities under the foundation's name, which is a
// far worse failure than a letter that cannot be styled.
//
// Inline styles and a table-free layout, because email clients are email clients.

import { escapeHtml } from './html'

/**
 * The foundation's logo at the head of a letter (`server/logo.ts`'s `letterLogo`). The
 * URL must be absolute: a mail client resolves it against nothing.
 */
export type LetterLogo = { url: string; alt: string; width: number; height: number }

/** The most a logo takes at the head of a letter, in CSS pixels; it is stored at 4x. */
const LOGO_BOX = { width: 80, height: 80 }

function logoHtml(logo: LetterLogo): string {
  // Width and height stated, so a client that blocks images (Outlook, by default) holds
  // the logo's space rather than collapsing the letter's top. Only an `https:` or
  // `http:` URL is ever written: it comes from our own server, but this is markup going
  // to third parties, and the rule in this file is that nothing reaches it unchecked.
  if (!/^https?:\/\//.test(logo.url)) return ''
  const scale = Math.min(1, LOGO_BOX.width / logo.width, LOGO_BOX.height / logo.height)
  const w = Math.round(logo.width * scale)
  const h = Math.round(logo.height * scale)
  return `<p style="margin:0 0 24px;"><img src="${escapeHtml(logo.url)}" alt="${escapeHtml(logo.alt)}" width="${w}" height="${h}" style="display:block;border:0;width:${w}px;height:${h}px;" /></p>`
}

export function letterHtml(bodyText: string, logo?: LetterLogo | null): string {
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
    logo ? logoHtml(logo) : '',
    blocks.join(''),
    '</div>',
  ].join('')
}
