import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import { rounds } from '../../../drizzle/schema'
import { asc } from 'drizzle-orm'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const Route = createFileRoute('/api/rounds')(
  {
    server: {
      handlers: {
        OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
        GET: async () => {
          const allRounds = await getDb().query.rounds.findMany({
            columns: { id: true, name: true, openedAt: true, closedAt: true },
            with: { client: { columns: { id: true, name: true } } },
            orderBy: [asc(rounds.createdAt)],
          })

          return new Response(JSON.stringify(allRounds, (_key, val) =>
            val instanceof Date ? val.toISOString() : val
          ), {
            status: 200,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        },
      },
    },
  } as any,
)
