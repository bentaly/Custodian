// Shared API config + helpers for the admin app. The main app's admin endpoints
// are gated by a shared token sent in the `x-admin-token` header (VITE_ADMIN_TOKEN,
// injected at build time). API_BASE points at the main app (staging or prod).

import { useEffect, useState } from 'react'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5174'
export const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? ''

// The canonical field registry is the main app's source of truth
// (src/lib/fieldMapping/canonical.ts). Rather than copy it here and let it drift, we
// fetch it from /api/admin/canonical-fields. Cached at module scope so it's loaded once.
export interface CanonicalField {
  key: string
  label: string
  required: boolean
  description?: string
}

let _canonicalCache: CanonicalField[] | null = null
let _canonicalPromise: Promise<CanonicalField[]> | null = null

export function fetchCanonicalFields(): Promise<CanonicalField[]> {
  if (_canonicalCache) return Promise.resolve(_canonicalCache)
  if (!_canonicalPromise) {
    _canonicalPromise = adminGet<CanonicalField[]>('/api/admin/canonical-fields')
      .then((fields) => {
        _canonicalCache = fields
        return fields
      })
      .catch((e) => {
        _canonicalPromise = null // let a later call retry
        throw e
      })
  }
  return _canonicalPromise
}

/** Canonical fields, or `[]` until the fetch resolves (synchronous on a warm cache). */
export function useCanonicalFields(): CanonicalField[] {
  const [fields, setFields] = useState<CanonicalField[]>(_canonicalCache ?? [])
  useEffect(() => {
    let active = true
    fetchCanonicalFields()
      .then((f) => active && setFields(f))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return fields
}

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
  status: 'received' | 'needs_review' | 'ai_proposed' | 'complete'
  rawPayload: Record<string, unknown>
  proposed: Record<string, { sourceKey: string | null; confidence: number }> | null
  resolved: Record<string, string> | null
  applicationId: string | null
  roundProgrammeId: string | null
  createdAt: string
  client: { id: string; name: string }
}

// The foundation's application reference is just the `externalApplicationId` canonical
// field — no dedicated column. Derive it from the stored mapping (sourceKey → canonical)
// and the raw payload, for display.
export function externalIdOf(row: IngestRow): string | null {
  const entry = Object.entries(row.resolved ?? {}).find(
    ([, canonical]) => canonical === 'externalApplicationId',
  )
  if (!entry) return null
  const value = row.rawPayload[entry[0]]
  return value == null || value === '' ? null : String(value)
}

export interface MappingRow {
  id: string
  clientId: string
  sourceKey: string
  canonicalField: string
  formType: 'application' | 'report'
  addedBy: string | null
  createdAt: string
}

// ─── Report ingest (grant reports) ───────────────────────────────────────────

// The report canonical registry, fetched from the main app like the application
// one (source of truth: src/lib/fieldMapping/reportCanonical.ts).
let _reportCanonicalCache: CanonicalField[] | null = null
let _reportCanonicalPromise: Promise<CanonicalField[]> | null = null

export function fetchReportCanonicalFields(): Promise<CanonicalField[]> {
  if (_reportCanonicalCache) return Promise.resolve(_reportCanonicalCache)
  if (!_reportCanonicalPromise) {
    _reportCanonicalPromise = adminGet<CanonicalField[]>('/api/admin/report-canonical-fields')
      .then((fields) => {
        _reportCanonicalCache = fields
        return fields
      })
      .catch((e) => {
        _reportCanonicalPromise = null // let a later call retry
        throw e
      })
  }
  return _reportCanonicalPromise
}

/** Report canonical fields, or `[]` until the fetch resolves. */
export function useReportCanonicalFields(): CanonicalField[] {
  const [fields, setFields] = useState<CanonicalField[]>(_reportCanonicalCache ?? [])
  useEffect(() => {
    let active = true
    fetchReportCanonicalFields()
      .then((f) => active && setFields(f))
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return fields
}

export interface ReportIngestRow {
  id: string
  status: 'received' | 'needs_review' | 'ai_proposed' | 'complete'
  rawPayload: Record<string, unknown>
  proposed: Record<string, { sourceKey: string | null; confidence: number }> | null
  resolved: Record<string, string> | null
  matchCandidates: Array<{ grantId: string; score: number; reasons: string[] }> | null
  reportId: string | null
  createdAt: string
  client: { id: string; name: string }
}

/** A client's grant, flattened for the report match picker. */
export interface GrantOption {
  id: string
  amountAwarded: string
  status: string
  decisionAt: string
  organisationName: string | null
  charityNumber: string | null
  externalApplicationId: string | null
  programmeName: string | null
  openMilestones: number
  totalMilestones: number
}
