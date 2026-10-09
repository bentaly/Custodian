import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { clientLogos, clients } from '../../drizzle/schema'
import type { LetterLogo } from '../lib/letterHtml'

// A foundation's logo, as everything outside the upload reads it. `clients.logo_url`
// holds the relative, hash-versioned URL the app draws; a letter needs it ABSOLUTE,
// because a mail client resolves it against nothing.

export function logoUrl(clientId: string, hash: string): string {
  return `/api/logo/${clientId}?v=${hash}`
}

/** The app's own origin, as the digests and invitations take it. */
function appOrigin(): string {
  return (process.env['BETTER_AUTH_URL'] ?? 'http://localhost:5174').replace(/\/+$/, '')
}

/**
 * The logo for the top of a letter this foundation sends, or null for none. Read when
 * the letter is RENDERED, so the stored HTML (letters are snapshots) carries it. The
 * address is versioned, but the route serves the current logo whatever the version, so
 * a letter re-sent after the logo changed shows the new one.
 */
export async function letterLogo(clientId: string): Promise<LetterLogo | null> {
  const [row] = await getDb()
    .select({
      hash: clientLogos.hash,
      width: clientLogos.width,
      height: clientLogos.height,
      name: clients.name,
    })
    .from(clientLogos)
    .innerJoin(clients, eq(clients.id, clientLogos.clientId))
    .where(eq(clientLogos.clientId, clientId))
  if (!row) return null
  return {
    url: `${appOrigin()}${logoUrl(clientId, row.hash)}`,
    alt: row.name,
    width: row.width,
    height: row.height,
  }
}
