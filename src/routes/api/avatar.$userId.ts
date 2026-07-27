import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { userAvatars, users } from '../../../drizzle/schema'
import { getAuthUser } from '../../server/session'

// Serves the bytes behind `users.image`. Authenticated and tenant-scoped like every
// other read: a signed-in user may fetch their own avatar, one belonging to a member of
// their own client, or — as a superadmin — any. Avatars are not public, so a leaked or
// guessed user id is not a way to enumerate faces across tenants.
//
// `private` caching, because the response is scoped to the viewer's session; `immutable`
// is safe because the URL carries a content hash, so an upload produces a new URL rather
// than needing the old one revalidated.
const CACHE_CONTROL = 'private, max-age=31536000, immutable'

export const Route = createFileRoute('/api/avatar/$userId')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { userId: string } }) => {
        const viewer = await getAuthUser()
        if (!viewer) return new Response(null, { status: 401 })

        const [row] = await getDb()
          .select({
            mimeType: userAvatars.mimeType,
            dataBase64: userAvatars.dataBase64,
            ownerClientId: users.clientId,
          })
          .from(userAvatars)
          .innerJoin(users, eq(users.id, userAvatars.userId))
          .where(eq(userAvatars.userId, params.userId))

        if (!row) return new Response(null, { status: 404 })

        const sameTenant = viewer.clientId != null && viewer.clientId === row.ownerClientId
        const allowed = viewer.role === 'superadmin' || viewer.id === params.userId || sameTenant
        // 404 rather than 403 — whether a user in another tenant has a photo is itself
        // not something to confirm.
        if (!allowed) return new Response(null, { status: 404 })

        const binary = atob(row.dataBase64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

        return new Response(bytes, {
          headers: {
            'Content-Type': row.mimeType,
            'Content-Length': String(bytes.length),
            'Cache-Control': CACHE_CONTROL,
          },
        })
      },
    },
  },
})
