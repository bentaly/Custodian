import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../server/db'
import { clientLogos } from '../../../drizzle/schema'
import { withDeadline } from '../../server/deadline'

// Serves a foundation's logo. PUBLIC, unlike `/api/avatar/$userId`, and that is the
// point of it: the logo is drawn at the top of the letters a foundation emails to
// charities, and a mail client fetches images with no session. A logo is something a
// foundation puts on its website; the only thing this confirms about a client id is
// that its foundation has one.
//
// `public` and `immutable`: the URL carries a content hash (`?v=`), so a new upload is
// a new URL. The route itself ignores the version and serves the current logo, which is
// what a letter re-sent after the logo changed should show.
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

// Same bound as the avatar route, for the same reason: an `<img>` is fetched by the
// browser, outside every timeout the app's own requests carry.
const LOGO_DEADLINE_MS = 12_000

export const Route = createFileRoute('/api/logo/$clientId')({
  server: {
    handlers: {
      GET: async ({ params }: { params: { clientId: string } }) => {
        // Not a uuid is not a logo, and must not reach the uuid column as a SQL error.
        if (!z.uuid().safeParse(params.clientId).success) {
          return new Response(null, { status: 404 })
        }
        try {
          return await withDeadline(
            loadLogo(params.clientId),
            LOGO_DEADLINE_MS,
            () => new Error(`logo exceeded ${LOGO_DEADLINE_MS}ms`),
          )
        } catch (err) {
          console.error('[logo] failed:', err)
          return new Response(null, { status: 503 })
        }
      },
    },
  },
})

async function loadLogo(clientId: string): Promise<Response> {
  const [row] = await getDb()
    .select({ mimeType: clientLogos.mimeType, dataBase64: clientLogos.dataBase64 })
    .from(clientLogos)
    .where(eq(clientLogos.clientId, clientId))
  if (!row) return new Response(null, { status: 404 })

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
