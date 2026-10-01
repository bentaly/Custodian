/**
 * How the app writes to somebody: a `mailto:` link, handed to whatever the person
 * reading mail on this machine actually uses. Two kinds of setup have to work, and each
 * one broke a different way before this file existed.
 *
 * - **Webmail registered as the handler** (Chrome with Gmail). The browser turns the
 *   link into a navigation to Gmail's compose page. In the SAME tab that replaces
 *   Custodian with Gmail, and the application somebody was reading is a Back press and
 *   a reload away. So every one of these links opens in a new tab (`MAILTO_LINK`).
 * - **A native client** (Outlook, Apple Mail). The browser hands the link to the
 *   operating system and nothing navigates, so the new tab is never needed and the
 *   browser does not keep one. What matters here is the address: `@` encoded as `%40`
 *   is legal, but some clients do not decode it and open a draft to nobody they can
 *   send to. So the address is encoded except for its `@`.
 *
 * Spaces in the subject and body are `%20`, never `+`: a `mailto:` is not a form
 * submission, and a client that reads the query literally shows the plus signs.
 */
export function mailtoHref(
  address: string,
  fields: { subject?: string; body?: string } = {},
): string {
  const to = encodeURIComponent(address.trim()).replace(/%40/g, '@')
  const query = (['subject', 'body'] as const)
    .filter((key) => fields[key])
    .map((key) => `${key}=${encodeURIComponent(fields[key]!)}`)
    .join('&')
  return `mailto:${to}${query ? `?${query}` : ''}`
}

/** Spread onto the anchor beside `href`. See the note above for why a new tab. */
export const MAILTO_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const
