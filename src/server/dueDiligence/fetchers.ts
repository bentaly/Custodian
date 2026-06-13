// ─── Due diligence: external register fetchers ───────────────────────────────
//
// Thin HTTP wrappers around each register. The contract is deliberate so the
// orchestrator can tell apart the spec's distinct failure modes:
//
//   • 200            → parsed body
//   • 404 / no match → `null`  (registration number not found → hard block)
//   • 5xx / network  → throw   (API down → mark for manual review, never pass)
//
// Fetchers are grouped behind the `DueDiligenceFetchers` interface so the
// orchestrator can be unit-tested with stubbed responses (no live network).

export interface DueDiligenceFetchers {
  charityCommission(regNumber: string): Promise<Record<string, unknown> | null>
  charityFinancialHistory(regNumber: string): Promise<unknown[] | null>
  oscr(regNumber: string): Promise<unknown>
  companiesHouse(regNumber: string): Promise<Record<string, unknown> | null>
  companiesHouseFilingHistory(regNumber: string): Promise<Record<string, unknown> | null>
  threeSixtyGiving(orgId: string): Promise<Record<string, unknown> | null>
}

class RegisterError extends Error {}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<Record<string, unknown> | unknown[] | null> {
  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch (e) {
    throw new RegisterError(`network error: ${String(e)}`)
  }
  if (res.status === 404) return null
  if (!res.ok) {
    throw new RegisterError(`HTTP ${res.status}`)
  }
  return (await res.json()) as Record<string, unknown> | unknown[]
}

export const liveFetchers: DueDiligenceFetchers = {
  async charityCommission(regNumber) {
    const key = process.env['CHARITY_COMMISSION_KEY']
    if (!key) throw new RegisterError('CHARITY_COMMISSION_KEY not set')
    const data = await getJson(
      `https://api.charitycommission.gov.uk/register/api/allcharitydetailsv2/${encodeURIComponent(regNumber)}/0`,
      { 'Ocp-Apim-Subscription-Key': key },
    )
    return data as Record<string, unknown> | null
  },

  async charityFinancialHistory(regNumber) {
    const key = process.env['CHARITY_COMMISSION_KEY']
    if (!key) return null // supplementary; absence just means trend checks stay unverified
    try {
      const data = await getJson(
        `https://api.charitycommission.gov.uk/register/api/charityfinancialhistory/${encodeURIComponent(regNumber)}/0`,
        { 'Ocp-Apim-Subscription-Key': key },
      )
      return Array.isArray(data) ? data : null
    } catch {
      return null
    }
  },

  async oscr(regNumber) {
    const key = process.env['OSCR_API_KEY']
    if (!key) throw new RegisterError('OSCR_API_KEY not set')
    return await getJson(
      `https://oscrapi.azurewebsites.net/api/all_charities?charitynumber=${encodeURIComponent(regNumber)}`,
      { 'x-functions-key': key },
    )
  },

  async companiesHouse(regNumber) {
    const key = process.env['COMPANIES_HOUSE_KEY']
    if (!key) throw new RegisterError('COMPANIES_HOUSE_KEY not set')
    const basicAuth = Buffer.from(`${key}:`).toString('base64')
    const data = await getJson(
      `https://api.company-information.service.gov.uk/company/${encodeURIComponent(regNumber)}`,
      { Authorization: `Basic ${basicAuth}` },
    )
    return data as Record<string, unknown> | null
  },

  async companiesHouseFilingHistory(regNumber) {
    const key = process.env['COMPANIES_HOUSE_KEY']
    if (!key) return null
    const basicAuth = Buffer.from(`${key}:`).toString('base64')
    try {
      const data = await getJson(
        `https://api.company-information.service.gov.uk/company/${encodeURIComponent(regNumber)}/filing-history`,
        { Authorization: `Basic ${basicAuth}` },
      )
      return data as Record<string, unknown> | null
    } catch {
      return null
    }
  },

  async threeSixtyGiving(orgId) {
    // Supplementary / info-only — swallow all failures.
    try {
      const data = await getJson(
        `https://api.threesixtygiving.org/api/v1/org/${encodeURIComponent(orgId)}/grants_received/?limit=50`,
        {},
      )
      return data as Record<string, unknown> | null
    } catch {
      return null
    }
  },
}
