import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { clients } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { conflict } from '../../lib/errors'
import { recordAudit } from '../audit'

/**
 * An admin renames their own foundation (Settings → Organisation details).
 *
 * Nothing keys on the name: tenancy, imports and every link use the client id, so a
 * rename moves nothing but words. Letters already sent keep the name they were sent
 * with (they are snapshots); the next letter, the header and the scoring prompts take
 * the new one, and so does the sender name on emails unless the foundation set its own
 * on the Letters page. Audited, because it signs every letter after it.
 */
export const renameOrganisation = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(255) }))
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw conflict('You are not in a foundation to rename.')
    const name = data.name.replace(/\s+/g, ' ')
    if (name === user.clientName) return { name }
    await getDb().update(clients).set({ name }).where(eq(clients.id, user.clientId))
    await recordAudit({
      actorUserId: user.id,
      action: 'organisation_renamed',
      clientId: user.clientId,
      metadata: { from: user.clientName, to: name },
    })
    return { name }
  })
