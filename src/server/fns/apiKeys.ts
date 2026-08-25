import { forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { apiKeys } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { recordAudit } from '../audit'
import { generateApiKey, generateWebhookToken, hashApiKey } from '../apiKeys'

// Keys belong to a client and gate the public submission endpoints. Management is
// admin-only and scoped to the caller's own client. The plaintext key is returned
// exactly once, by createApiKey — it is never stored or readable afterwards.
//
// Two kinds share this table because they are the same secret with the same
// lifecycle, differing only in how the sender presents it: `secret` in an
// Authorization header, `webhook` in a URL path, for platforms that cannot set
// headers. One table means one revoke button and one "last used" column.

export const listApiKeys = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireRole('admin', 'superadmin')
  if (!user.clientId) return []
  return getDb().query.apiKeys.findMany({
    where: eq(apiKeys.clientId, user.clientId),
    columns: {
      id: true,
      name: true,
      last4: true,
      kind: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
    },
    orderBy: (k, { desc }) => [desc(k.createdAt)],
  })
})

export const createApiKey = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      name: z.string().trim().min(1).max(80),
      kind: z.enum(['secret', 'webhook']).default('secret'),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')

    const { key, last4 } = data.kind === 'webhook' ? generateWebhookToken() : generateApiKey()
    const keyHash = await hashApiKey(key)
    const [row] = await getDb()
      .insert(apiKeys)
      .values({
        clientId: user.clientId,
        name: data.name,
        keyHash,
        last4,
        kind: data.kind,
        createdBy: user.id,
      })
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        last4: apiKeys.last4,
        kind: apiKeys.kind,
        createdAt: apiKeys.createdAt,
      })

    // Tenant-scoped: a key belongs to no application, which is why the audit row is
    // written against the client directly. `last4` and the name are all that can be
    // recorded — the key itself is unrecoverable by design.
    await recordAudit({
      actorUserId: user.id,
      action: 'api_key_created',
      clientId: user.clientId,
      metadata: { name: data.name, last4, kind: data.kind },
    })

    // `key` (plaintext) is returned only here — surfaced once in the UI, never stored.
    return { ...row!, key }
  })

export const revokeApiKey = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw forbidden('No organisation is associated with your account.')
    const [row] = await getDb()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, data.id), eq(apiKeys.clientId, user.clientId)))
      // `name` and `last4` come back for the audit row, not for the caller: an entry
      // reading "revoked an API key" with only a UUID names a key nobody can identify
      // once it is gone, which is precisely when somebody asks which one it was.
      .returning({
        id: apiKeys.id,
        name: apiKeys.name,
        last4: apiKeys.last4,
        kind: apiKeys.kind,
      })
    if (!row) throw notFoundError('Key not found')

    await recordAudit({
      actorUserId: user.id,
      action: 'api_key_revoked',
      clientId: user.clientId,
      metadata: { apiKeyId: row.id, name: row.name, last4: row.last4, kind: row.kind },
    })
    return { id: row.id }
  })
