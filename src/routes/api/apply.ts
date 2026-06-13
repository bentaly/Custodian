import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import { applications, roundProgrammes } from '../../../drizzle/schema'
import { eq } from 'drizzle-orm'
import { CreateApplicationSchema } from '../../lib/validators/application'
import { runDueDiligence } from '../../server/dueDiligence/run'
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

          const {
            roundProgrammeId,
            organisationName,
            charityNumber,
            companyNumber,
            bankName,
            bankAccountName,
            bankAccountNumber,
            bankSortCode,
            amountRequested,
            responses,
          } = parsed.data

          const roundProgramme = await getDb().query.roundProgrammes.findFirst({
            where: eq(roundProgrammes.id, roundProgrammeId),
            with: { round: true },
          })
          if (!roundProgramme) {
            return jsonResponse({ error: 'Not found' }, 404)
          }
          if (getRoundStatus(roundProgramme.round) !== 'open') {
            return jsonResponse({ error: 'This round is not currently open for applications' }, 409)
          }

          const dueDiligence = await runDueDiligence({
            charityNumber,
            companyNumber,
            amountRequested,
          })

          const id = crypto.randomUUID()
          await getDb().insert(applications).values({
            id,
            roundProgrammeId,
            organisationName,
            charityNumber,
            companyNumber,
            bankName,
            bankAccountName,
            bankAccountNumber,
            bankSortCode,
            amountRequested: String(amountRequested),
            responses,
            dueDiligenceStatus: dueDiligence.status,
            dueDiligenceChecks: dueDiligence.checks,
            dueDiligenceCheckedAt: new Date(dueDiligence.checkedAt),
          })

          const application = await getDb().query.applications.findFirst({
            where: (a, { eq }) => eq(a.id, id),
          })

          return jsonResponse({ application, dueDiligence }, 201)
        },
      },
    },
  } as any,
)
