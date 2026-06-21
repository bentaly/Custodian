import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { apiKeys } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { generateApiKey, hashApiKey } from '../apiKeys'

// Keys belong to a client and gate the public /api/apply endpoint. Management is
// admin-only and scoped to the caller's own client. The plaintext key is returned
// exactly once, by createApiKey — it is never stored or readable afterwards.

export const listApiKeys = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireRole('admin', 'superadmin')
  if (!user.clientId) return []
  return getDb().query.apiKeys.findMany({
    where: eq(apiKeys.clientId, user.clientId),
    columns: { id: true, name: true, last4: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: (k, { desc }) => [desc(k.createdAt)],
  })
})

export const createApiKey = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ name: z.string().trim().min(1).max(80) }))
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw new Error('No organisation associated with your account')

    const { key, last4 } = generateApiKey()
    const keyHash = await hashApiKey(key)
    const [row] = await getDb()
      .insert(apiKeys)
      .values({ clientId: user.clientId, name: data.name, keyHash, last4, createdBy: user.id })
      .returning({ id: apiKeys.id, name: apiKeys.name, last4: apiKeys.last4, createdAt: apiKeys.createdAt })

    // `key` (plaintext) is returned only here — surfaced once in the UI, never stored.
    return { ...row!, key }
  })

export const revokeApiKey = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('admin', 'superadmin')
    if (!user.clientId) throw new Error('No organisation associated with your account')
    const [row] = await getDb()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, data.id), eq(apiKeys.clientId, user.clientId)))
      .returning({ id: apiKeys.id })
    if (!row) throw new Error('Key not found')
    return row
  })
