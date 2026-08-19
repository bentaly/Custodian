import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { userAvatars, users } from '../../../drizzle/schema'
import { getAuthUser } from '../../server/session'
import { withDeadline } from '../../server/deadline'

// Serves the bytes behind `users.image`. Authenticated and tenant-scoped like every
// other read: a signed-in user may fetch their own avatar, one belonging to a member of
// their own client, or — as a superadmin — any. Avatars are not public, so a leaked or
// guessed user id is not a way to enumerate faces across tenants.
//
// `private` caching, because the response is scoped to the viewer's session; `immutable`
// is safe because the URL carries a content hash, so an upload produces a new URL rather
// than needing the old one revalidated.
const CACHE_CONTROL = 'private, max-age=31536000, immutable'

/**
 * This route had no bound at all, and it is on the hot path of every authenticated
 * page: `AppHeader` renders an `<img src="/api/avatar/…">` for anyone with a photo.
 *
 * Two separate safety nets miss it. It is not a server function, so `src/start.ts`'s
 * middleware never wraps it; and an `<img>` is fetched by the browser itself, so
 * `src/lib/requestTimeout.ts` — which only wraps `fetch` — cannot bound it either.
 * That left it as the one hot-path request with nothing watching, while calling the
 * very `getAuthUser` session lookup that the 18 Aug hang has been narrowed down to.
 *
 * Same 12s as everywhere else, and under the browser's 15s for the same reason.
 */
const AVATAR_DEADLINE_MS = 12_000

export const Route = createFileRoute('/api/avatar/$userId')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { userId: string } }) => {
        try {
          return await serveAvatar(params.userId)
        } catch (err) {
          // A broken image beats a connection the browser holds open for minutes.
          console.error('[avatar] failed:', err)
          return new Response(null, { status: 503 })
        }
      },
    },
  },
})

async function serveAvatar(userId: string): Promise<Response> {
  return withDeadline(
    loadAvatar(userId),
    AVATAR_DEADLINE_MS,
    () => new Error(`avatar exceeded ${AVATAR_DEADLINE_MS}ms`),
  )
}

async function loadAvatar(userId: string): Promise<Response> {
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
    .where(eq(userAvatars.userId, userId))

  if (!row) return new Response(null, { status: 404 })

  const sameTenant = viewer.clientId != null && viewer.clientId === row.ownerClientId
  const allowed = viewer.role === 'superadmin' || viewer.id === userId || sameTenant
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
}
