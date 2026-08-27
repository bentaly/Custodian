// One round and the programmes it funds, for the admin app's test submitters.
//
// Gated by `x-admin-token`, for the reason on `/api/rounds`. This one leaked more:
// unauthenticated it returned the whole `clients` row (including `createdByEmail`,
// a Canvas operator's address) and whole `programmes` rows — `description`, `goal`
// and `tags`, which are a foundation's private funding strategy and the very text
// fed to the Custodian score. Columns are now named explicitly rather than pulled
// through `with: { client: true }`, so widening the schema cannot silently widen
// this response again.
import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import { rounds } from '../../../drizzle/schema'
import { eq } from 'drizzle-orm'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

export const Route = createFileRoute('/api/round/$roundId')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      GET: async ({ request, params }: { request: Request; params: { roundId: string } }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const round = await getDb().query.rounds.findFirst({
          where: eq(rounds.id, params.roundId),
          columns: { id: true, clientId: true, name: true, openedAt: true, closedAt: true },
          with: {
            client: { columns: { id: true, name: true } },
            roundProgrammes: {
              columns: { id: true },
              with: {
                programme: {
                  // What a test submitter needs to build a payload: which programme to
                  // name, and the unit its impact is measured in. Not the goal, not the
                  // description, not the tags.
                  columns: { id: true, name: true, impactUnit: true, impactUnitLabel: true },
                },
              },
              orderBy: (rp: any, { asc }: any) => [asc(rp.createdAt)],
            },
          },
        })

        if (!round) return adminJson({ error: 'Round not found' }, 404)

        const { roundProgrammes, ...rest } = round
        return adminJson(
          {
            ...rest,
            programmes: roundProgrammes.map((rp) => ({ ...rp.programme, roundProgrammeId: rp.id })),
          },
          200,
        )
      },
    },
  },
} as any)
