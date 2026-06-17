import { createFileRoute } from '@tanstack/react-router'
import { CreateApplicationSchema } from '../../lib/validators/application'
import {
  createApplicationFromCanonical,
  fetchRoundProgrammeForApplication,
} from '../../server/applications/create'
import { getRoundStatus } from '../../lib/roundStatus'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function jsonResponse(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export const Route = createFileRoute('/api/apply')(
  {
    server: {
      handlers: {
        OPTIONS: async () => {
          return new Response(null, { status: 204, headers: CORS_HEADERS })
        },
        POST: async ({ request }: { request: Request }) => {
          let rawBody: unknown
          try {
            rawBody = await request.json()
          } catch {
            return jsonResponse({ error: 'Invalid JSON' }, 400)
          }

          const parsed = CreateApplicationSchema.safeParse(rawBody)
          if (!parsed.success) {
            const missing = parsed.error.issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            }))
            return jsonResponse({ error: 'Missing or invalid fields', fields: missing }, 400)
          }

          const roundProgramme = await fetchRoundProgrammeForApplication(
            parsed.data.roundProgrammeId,
          )
          if (!roundProgramme) {
            return jsonResponse({ error: 'Not found' }, 404)
          }
          if (getRoundStatus(roundProgramme.round) !== 'open') {
            return jsonResponse({ error: 'This round is not currently open for applications' }, 409)
          }

          const { application, dueDiligence, custodian } =
            await createApplicationFromCanonical(roundProgramme, parsed.data)

          return jsonResponse({ application, dueDiligence, custodian }, 201)
        },
      },
    },
  } as any,
)
