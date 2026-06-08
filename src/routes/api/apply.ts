import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import {
  applications,
  applicationResponses,
  programmes,
  formFields,
} from '../../../drizzle/schema'
import { eq } from 'drizzle-orm'
import { CreateApplicationSchema } from '../../lib/validators/application'

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

async function fetchCharityCommissionData(regNumber: string) {
  const key = process.env['CHARITY_COMMISSION_KEY']
  if (!key) return { _note: 'CHARITY_COMMISSION_KEY not set' }

  try {
    const res = await fetch(
      `https://api.charitycommission.gov.uk/register/api/allcharitydetails/${regNumber}/0`,
      { headers: { 'Ocp-Apim-Subscription-Key': key } },
    )
    if (!res.ok) return { _error: `HTTP ${res.status}`, _body: await res.text() }
    return await res.json()
  } catch (e) {
    return { _error: String(e) }
  }
}

async function fetchCompaniesHouseData(regNumber: string) {
  const key = process.env['COMPANIES_HOUSE_KEY']
  if (!key) return { _note: 'COMPANIES_HOUSE_KEY not set' }

  try {
    const basicAuth = Buffer.from(`${key}:`).toString('base64')
    const res = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(regNumber)}&items_per_page=3`,
      { headers: { Authorization: `Basic ${basicAuth}` } },
    )
    if (!res.ok) return { _error: `HTTP ${res.status}`, _body: await res.text() }
    return await res.json()
  } catch (e) {
    return { _error: String(e) }
  }
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
            programmeId,
            organisationName,
            organisationRegistrationNumber,
            organisationType,
            bankName,
            bankAccountName,
            bankAccountNumber,
            bankSortCode,
            amountRequested,
            responses = {},
          } = parsed.data

          const programme = await getDb().query.programmes.findFirst({
            where: eq(programmes.id, programmeId),
            with: { round: true },
          })
          if (!programme) {
            return jsonResponse({ error: 'Programme not found' }, 404)
          }
          if (programme.round.status !== 'open') {
            return jsonResponse(
              { error: `Round is not open (status: ${programme.round.status})` },
              409,
            )
          }

          const fields = await getDb().query.formFields.findMany({
            where: eq(formFields.programmeId, programmeId),
          })
          const validFieldIds = new Set(fields.map((f) => f.id))
          const responseEntries = Object.entries(responses).filter(([fieldId]) =>
            validFieldIds.has(fieldId),
          )

          let dueDiligenceData: Record<string, unknown> | undefined
          if (organisationRegistrationNumber?.trim()) {
            const [charityCommission, companiesHouse] = await Promise.all([
              fetchCharityCommissionData(organisationRegistrationNumber.trim()),
              fetchCompaniesHouseData(organisationRegistrationNumber.trim()),
            ])
            dueDiligenceData = {
              charityCommission,
              companiesHouse,
              fetchedAt: new Date().toISOString(),
            }
          }

          const id = crypto.randomUUID()
          await getDb().insert(applications).values({
            id,
            programmeId,
            organisationName,
            organisationRegistrationNumber,
            organisationType,
            bankName,
            bankAccountName,
            bankAccountNumber,
            bankSortCode,
            amountRequested: String(amountRequested),
            dueDiligenceData,
          })

          if (responseEntries.length > 0) {
            await getDb().insert(applicationResponses).values(
              responseEntries.map(([fieldId, value]) => ({
                applicationId: id,
                fieldId,
                value,
              })),
            )
          }

          const application = await getDb().query.applications.findFirst({
            where: (a, { eq }) => eq(a.id, id),
            with: { responses: { with: { field: true } } },
          })

          return jsonResponse({ application, dueDiligenceData }, 201)
        },
      },
    },
  } as any,
)
