import { createFileRoute } from '@tanstack/react-router'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db'
import { awards } from '../../../drizzle/schema'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// The awards of a client, flattened for the report review queue's match picker:
// enough context to recognise a grant (organisation, programme, amount, award
// date, external application ID) plus its open-milestone count so the reviewer
// can see whether a report is even expected.
export const Route = createFileRoute('/api/admin/awards')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        GET: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          const clientId = new URL(request.url).searchParams.get('clientId')
          if (!clientId) return adminJson({ error: 'clientId is required' }, 400)

          const rows = await getDb().query.awards.findMany({
            where: eq(awards.clientId, clientId),
            orderBy: (g, { desc }) => [desc(g.decisionAt)],
            with: {
              application: {
                columns: {
                  organisationName: true,
                  charityNumber: true,
                  externalApplicationId: true,
                },
                with: {
                  roundProgramme: {
                    columns: { id: true },
                    with: { programme: { columns: { name: true } } },
                  },
                },
              },
              schedule: { columns: { id: true, label: true, dueDate: true, submittedDate: true } },
            },
          })

          const flat = rows.map((g) => ({
            id: g.id,
            amountAwarded: g.amountAwarded,
            status: g.status,
            decisionAt: g.decisionAt,
            organisationName: g.application?.organisationName ?? null,
            charityNumber: g.application?.charityNumber ?? null,
            externalApplicationId: g.application?.externalApplicationId ?? null,
            programmeName: g.application?.roundProgramme?.programme?.name ?? null,
            openMilestones: g.schedule.filter((r) => !r.submittedDate).length,
            totalMilestones: g.schedule.length,
          }))
          return adminJson(flat, 200)
        },
      },
    },
  } as any,
)
