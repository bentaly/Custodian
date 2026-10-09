import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { clientLogos, clients } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { conflict } from '../../lib/errors'
import { LOGO_HEIGHT, LOGO_MIME_TYPES, LOGO_WIDTH, MAX_LOGO_ENCODED_BYTES } from '../../lib/logo'
import { logoUrl } from '../logo'

// The foundation's logo: the bytes to `client_logos`, the URL that serves them to
// `clients.logo_url`, in one `db.batch` (no transactions on neon-http, and a URL pointing
// at bytes never written would draw a broken image in the header and in every letter).
// Admins only, for their own foundation: a superadmin has no foundation of their own.

const SIGNATURES: Record<(typeof LOGO_MIME_TYPES)[number], number[]> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
}

/**
 * The route serves these bytes publicly under the type given, so they must BE that type,
 * whatever a caller that skipped the form sent. The signature is the cheap, sufficient check.
 */
function matchesType(dataBase64: string, type: (typeof LOGO_MIME_TYPES)[number]): boolean {
  try {
    const head = atob(dataBase64.slice(0, 12))
    return SIGNATURES[type].every((b, i) => head.charCodeAt(i) === b)
  } catch {
    return false
  }
}

async function contentHash(dataBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataBase64))
  return Array.from(new Uint8Array(digest).subarray(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function requireOwnFoundation() {
  const user = await requireRole('admin', 'superadmin')
  if (!user.clientId) throw conflict('A logo belongs to a foundation, and you are not in one.')
  return { user, clientId: user.clientId }
}

export const updateOrganisationLogo = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      mimeType: z.enum(LOGO_MIME_TYPES),
      dataBase64: z.string().min(1).max(MAX_LOGO_ENCODED_BYTES),
      width: z.number().int().min(1).max(LOGO_WIDTH),
      height: z.number().int().min(1).max(LOGO_HEIGHT),
    }),
  )
  .handler(async ({ data }) => {
    const { clientId } = await requireOwnFoundation()
    if (!matchesType(data.dataBase64, data.mimeType)) {
      throw conflict('That file is not the image it says it is.')
    }
    const hash = await contentHash(data.dataBase64)
    const url = logoUrl(clientId, hash)
    const db = getDb()
    const values = {
      mimeType: data.mimeType,
      dataBase64: data.dataBase64,
      hash,
      width: data.width,
      height: data.height,
    }
    await db.batch([
      db
        .insert(clientLogos)
        .values({ clientId, ...values })
        .onConflictDoUpdate({
          target: clientLogos.clientId,
          set: { ...values, updatedAt: new Date() },
        }),
      db.update(clients).set({ logoUrl: url }).where(eq(clients.id, clientId)),
    ])
    return { logoUrl: url }
  })

export const removeOrganisationLogo = createServerFn({ method: 'POST' }).handler(async () => {
  const { clientId } = await requireOwnFoundation()
  const db = getDb()
  await db.batch([
    db.delete(clientLogos).where(eq(clientLogos.clientId, clientId)),
    db.update(clients).set({ logoUrl: null }).where(eq(clients.id, clientId)),
  ])
  return { logoUrl: null }
})
