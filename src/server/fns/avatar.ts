import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { userAvatars, users } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { ALLOWED_AVATAR_TYPES, MAX_ENCODED_BYTES } from '../../lib/avatar'

// Profile photos. The bytes go to `user_avatars`; `users.image` gets the URL of the
// route that serves them, hash-versioned so a new upload busts the immutable cache on
// the old one. Both writes go through db.batch — neon-http has no transactions, and a
// `users.image` pointing at bytes that were never written would render a broken avatar.

/** Short content hash — enough to change the URL on every new upload. */
async function contentHash(dataBase64: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataBase64))
  return Array.from(new Uint8Array(digest).subarray(0, 6))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function avatarUrl(userId: string, hash: string) {
  return `/api/avatar/${userId}?v=${hash}`
}

export const updateProfilePhoto = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      mimeType: z.enum(ALLOWED_AVATAR_TYPES),
      // Length is the base64 character count, which is what MAX_ENCODED_BYTES bounds.
      // Checked here as well as client-side: this endpoint is reachable directly.
      dataBase64: z.string().min(1).max(MAX_ENCODED_BYTES),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const hash = await contentHash(data.dataBase64)
    const url = avatarUrl(user.id, hash)

    await getDb().batch([
      getDb()
        .insert(userAvatars)
        .values({ userId: user.id, mimeType: data.mimeType, dataBase64: data.dataBase64, hash })
        .onConflictDoUpdate({
          target: userAvatars.userId,
          set: { mimeType: data.mimeType, dataBase64: data.dataBase64, hash, updatedAt: new Date() },
        }),
      getDb().update(users).set({ image: url }).where(eq(users.id, user.id)),
    ])

    return { image: url }
  })

export const removeProfilePhoto = createServerFn({ method: 'POST' }).handler(async () => {
  const user = await requireAuthUser()
  await getDb().batch([
    getDb().delete(userAvatars).where(eq(userAvatars.userId, user.id)),
    getDb().update(users).set({ image: null }).where(eq(users.id, user.id)),
  ])
  return { image: null }
})
