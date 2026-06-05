import { createFileRoute } from '@tanstack/react-router'
import { getDb } from '../../server/db'
import {
  applications,
  applicationResponses,
  programmes,
  formFields,
} from '../../../drizzle/schema'
import { eq } from 'drizzle-orm'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

async function fetchCharityCommissionData(charityNumber: string) {
  const key = process.env['CHARITY_COMMISSION_KEY']
  if (!key) return { _note: 'CHARITY_COMMISSION_KEY not set' }

  try {
    const res = await fetch(
      `https://api.charitycommission.gov.uk/register/api/allcharitydetails/${charityNumber}/0`,
      { headers: { 'Ocp-Apim-Subscription-Key': key } },
    )
    if (!res.ok) return { _error: `HTTP ${res.status}`, _body: await res.text() }
    return await res.json()
  } catch (e) {
    return { _error: String(e) }
  }
}

async function fetchCompaniesHouseData(charityNumber: string) {
  const key = process.env['COMPANIES_HOUSE_KEY']
  if (!key) return { _note: 'COMPANIES_HOUSE_KEY not set' }

  // Companies House search by name or company number
  // Charity numbers don't map directly, but many charities are also companies
  try {
    const basicAuth = Buffer.from(`${key}:`).toString('base64')
    const res = await fetch(
      `https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(charityNumber)}&items_per_page=3`,
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
          let body: unknown
          try {
            body = await request.json()
          } catch {
            return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
              status: 400,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            })
          }

          const {
            programmeId,
            organisationName,
            charityNumber,
            contactName,
            contactEmail,
            amountRequested,
            responses = {},
          } = body as Record<string, unknown>

          // Basic validation
          if (!programmeId || !organisationName || !contactName || !contactEmail || !amountRequested) {
            return new Response(
              JSON.stringify({ error: 'Missing required fields' }),
              { status: 422, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
            )
          }

          // Verify programme exists and its round is open
          const programme = await getDb().query.programmes.findFirst({
            where: eq(programmes.id, programmeId as string),
            with: { round: true },
          })
          if (!programme) {
            return new Response(
              JSON.stringify({ error: 'Programme not found' }),
              { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
            )
          }
          if (programme.round.status !== 'open') {
            return new Response(
              JSON.stringify({ error: `Round is not open (status: ${programme.round.status})` }),
              { status: 409, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
            )
          }

          // Validate that response field IDs actually belong to this programme's form
          const fields = await getDb().query.formFields.findMany({
            where: eq(formFields.programmeId, programmeId as string),
          })
          const validFieldIds = new Set(fields.map((f) => f.id))
          const responseEntries = Object.entries(responses as Record<string, string>).filter(
            ([fieldId]) => validFieldIds.has(fieldId),
          )

          // Due diligence (run in parallel)
          let dueDiligenceData: Record<string, unknown> | undefined
          if (charityNumber && typeof charityNumber === 'string' && charityNumber.trim()) {
            const [charityCommission, companiesHouse] = await Promise.all([
              fetchCharityCommissionData(charityNumber.trim()),
              fetchCompaniesHouseData(charityNumber.trim()),
            ])
            dueDiligenceData = {
              charityCommission,
              companiesHouse,
              fetchedAt: new Date().toISOString(),
            }
          }

          // Insert application
          const id = crypto.randomUUID()
          await getDb().insert(applications).values({
            id,
            programmeId: programmeId as string,
            organisationName: organisationName as string,
            charityNumber: charityNumber as string | undefined,
            contactName: contactName as string,
            contactEmail: contactEmail as string,
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

          return new Response(JSON.stringify({ application, dueDiligenceData }), {
            status: 201,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          })
        },
      },
    },
  } as any,
)
