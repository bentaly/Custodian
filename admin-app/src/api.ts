// Shared API config + helpers for the admin app. The main app's admin endpoints
// are gated by a shared token sent in the `x-admin-token` header (VITE_ADMIN_TOKEN,
// injected at build time). API_BASE points at the main app (staging or prod).

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5174'
export const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? ''

// Mirror of the main app's canonical field registry (src/lib/fieldMapping/canonical.ts).
// Kept in sync by hand — the admin app can't import from the main app's source.
export const CANONICAL_FIELDS: Array<{ key: string; label: string; required: boolean }> = [
  { key: 'externalApplicationId', label: 'External application ID', required: true },
  { key: 'organisationName', label: 'Organisation name', required: true },
  { key: 'amountRequested', label: 'Amount requested', required: true },
  { key: 'bankName', label: 'Bank name', required: true },
  { key: 'bankAccountName', label: 'Bank account name', required: true },
  { key: 'bankAccountNumber', label: 'Bank account number', required: true },
  { key: 'bankSortCode', label: 'Bank sort code', required: true },
  { key: 'charityNumber', label: 'Charity number', required: false },
  { key: 'companyNumber', label: 'Company number', required: false },
]

// The admin app sits behind Cloudflare Access, which exposes the signed-in operator's
// identity at this edge endpoint. We forward the email to the main app (x-admin-actor)
// so provisioning can be attributed. Cached; null off-Cloudflare (e.g. localhost 404).
let _actor: string | null | undefined
async function actorEmail(): Promise<string | null> {
  if (_actor !== undefined) return _actor
  let email: string | null = null
  try {
    const res = await fetch('/cdn-cgi/access/get-identity')
    if (res.ok) email = (await res.json())?.email ?? null
  } catch {
    email = null
  }
  _actor = email
  return email
}

async function adminHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const email = await actorEmail()
  return {
    'x-admin-token': ADMIN_TOKEN,
    ...(email ? { 'x-admin-actor': email } : {}),
    ...extra,
  }
}

async function parse(res: Response) {
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const msg = data?.error ?? `HTTP ${res.status}`
    const err = new Error(msg) as Error & { fields?: Array<{ field: string; message: string }> }
    if (data?.fields) err.fields = data.fields
    throw err
  }
  return data
}

export async function adminGet<T = unknown>(path: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, { headers: await adminHeaders() }).then(parse)
}

export async function adminPost<T = unknown>(path: string, body: unknown): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: await adminHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }).then(parse)
}

export async function adminDelete<T = unknown>(path: string): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: await adminHeaders(),
  }).then(parse)
}

export interface IngestRow {
  id: string
  status: 'needs_review' | 'ai_proposed' | 'complete'
  externalApplicationId: string | null
  rawPayload: Record<string, unknown>
  proposed: Record<string, { sourceKey: string | null; confidence: number }> | null
  resolved: Record<string, string> | null
  applicationId: string | null
  roundProgrammeId: string | null
  createdAt: string
  client: { id: string; name: string }
}

export interface MappingRow {
  id: string
  clientId: string
  sourceKey: string
  canonicalField: string
  addedBy: string | null
  createdAt: string
}
