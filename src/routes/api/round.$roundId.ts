import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import { rounds } from '../../../drizzle/schema'
import { eq } from 'drizzle-orm'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const Route = createFileRoute('/api/round/$roundId')(
  {
    server: {
      handlers: {
        OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        GET: async ({ params }: { params: { roundId: string } }) => {
          const round = await getDb().query.rounds.findFirst({
            where: eq(rounds.id, params.roundId),
            with: {
              client: true,
              programmes: {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                orderBy: (p: any, { asc }: any) => [asc(p.name)],
                with: {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formFields: { orderBy: (f: any, { asc }: any) => [asc(f.displayOrder)] },
                },
              },
            },
          })

          if (!round) {
            return new Response(JSON.stringify({ error: 'Round not found' }), {
              status: 404,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            })
          }

          return new Response(JSON.stringify(round, (_key, val) =>
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
