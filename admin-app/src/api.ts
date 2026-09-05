// Shared API config + helpers for the admin app. The main app's admin endpoints
// are gated by a shared token sent in the `x-admin-token` header (VITE_ADMIN_TOKEN,
// injected at build time). API_BASE points at the main app (staging or prod).

import { useEffect, useState } from 'react'

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5174'
export const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? ''

// ─── Submission API key ──────────────────────────────────────────────────────
//
// The key the TEST submitters send to /api/apply and /api/submit-report as
// `Authorization: Bearer …`. Unlike ADMIN_TOKEN this is a foundation's own key, so
// it names which client a test submission lands under.
//
// Build-time default (`VITE_APPLY_API_KEY` in .env.local) with a localStorage
// override, rather than localStorage alone: a fresh browser profile or a cleared
// site data meant re-generating a key in the main app before you could send a single
// test submission, and the key was typed separately into three different tabs.
const APPLY_KEY_STORAGE = 'apply_api_key'
export const DEFAULT_APPLY_API_KEY = import.meta.env.VITE_APPLY_API_KEY ?? ''

export function getApplyApiKey(): string {
  return localStorage.getItem(APPLY_KEY_STORAGE) ?? DEFAULT_APPLY_API_KEY
}

export function setApplyApiKey(key: string) {
  // Clearing the box falls back to the build-time key rather than to nothing.
  if (key) localStorage.setItem(APPLY_KEY_STORAGE, key)
  else localStorage.removeItem(APPLY_KEY_STORAGE)
  for (const fn of applyKeyListeners) fn(getApplyApiKey())
}

const applyKeyListeners = new Set<(key: string) => void>()

/** The current submission API key, shared across every submitter tab. */
export function useApplyApiKey(): [string, (key: string) => void] {
  const [key, setKey] = useState(getApplyApiKey)
  useEffect(() => {
    applyKeyListeners.add(setKey)
    return () => {
      applyKeyListeners.delete(setKey)
    }
  }, [])
  return [key, setApplyApiKey]
}

/** POST a raw payload to a public key-authed endpoint, the way a foundation would. */
export async function submitWithApiKey(
  path: '/api/apply' | '/api/submit-report',
  payload: unknown,
  apiKey: string,
): Promise<{ status: string; ingestId?: string; reportIngestId?: string }> {
  if (!apiKey.trim()) {
    throw new Error(
      'No API key. Set one in the key box above, or bake one in as VITE_APPLY_API_KEY in admin-app/.env.local.',
    )
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data?.fields
      ? `${data.error}: ${data.fields.map((f: { field: string; message: string }) => `${f.field} (${f.message})`).join(', ')}`
      : (data?.error ?? `HTTP ${res.status}`)
    throw new Error(detail)
  }
  return data
}

// The canonical field registry is the main app's source of truth
// (src/lib/fieldMapping/canonical.ts). Rather than copy it here and let it drift, we
// fetch it from /api/admin/canonical-fields. Cached at module scope so it's loaded once.
export interface CanonicalField {
  key: string
  label: string
  required: boolean
  /**
   * How much the field's absence costs: `required` blocks the application, `one_of`
   * blocks it only if no sibling in `oneOfGroup` resolves, `expected` never blocks.
   * Optional because the report registry is still two-tier and omits it.
   */
  tier?: 'required' | 'one_of' | 'expected' | 'optional'
  /** Index of the one-of group this field belongs to; null for every other field. */
  oneOfGroup?: number | null
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

export type IngestStatus = 'received' | 'needs_review' | 'ai_proposed' | 'complete'

// ─── Why a submission is where it is ─────────────────────────────────────────
//
// Computed by the main app (src/server/fieldMapping/diagnose.ts) and attached to
// every ingest row. Not derivable here: the reasons come from the zod validators
// and the programmes table, neither of which this app can see.
export type BlockerCode =
  | 'pipeline_running'
  | 'pipeline_stalled'
  | 'programme_unmapped'
  | 'programme_unknown'
  | 'programme_not_open'
  | 'required_unmapped'
  | 'one_of_unmet'
  | 'invalid_value'
  | 'grant_unmatched'

export interface Blocker {
  code: BlockerCode
  severity: 'blocking' | 'info'
  title: string
  detail: string
  fix: string
  fields?: Array<{ key: string; label: string; message?: string }>
}

export interface IngestRow {
  id: string
  status: IngestStatus
  rawPayload: Record<string, unknown>
  proposed: Record<string, { sourceKey: string | null; confidence: number }> | null
  resolved: Record<string, string> | null
  /**
   * Canonical fields whose value a reviewer TYPED rather than pointed at an incoming
   * field: canonicalField → value. Separate from `resolved` because that map is keyed on
   * the source key and a typed value has none — which is also why the grid has to seed
   * its inputs from here, or re-opening a resolved row would show the field empty.
   */
  providedValues: Record<string, string> | null
  applicationId: string | null
  roundProgrammeId: string | null
  createdAt: string
  client: { id: string; name: string }
  blockers: Blocker[]
  /**
   * Incoming field names that already map themselves, so the grid can stop offering to
   * teach them. Computed by the main app (server/fieldMapping/provenance.ts) because it
   * depends on the built-in dictionary and this client's lookup table, neither of which
   * this app can see. Keyed on the SOURCE key, not the canonical field, so it still
   * answers correctly after a reviewer changes a dropdown.
   */
  autoMappings?: Record<string, { canonicalField: string; via: AutoMappingVia }>
}

/**
 * Sentinel `sourceKey` meaning "the reviewer typed this value" rather than naming an
 * incoming field. Mirrors `PROVIDED` in the main app's server/fieldMapping/assemble.ts;
 * this app cannot import from there, so the two must be changed together — same rule as
 * `BlockerCode` above.
 */
export const PROVIDED = '(provided)'

/** How an incoming field name resolves without anyone teaching it. */
export type AutoMappingVia = 'identity' | 'dictionary' | 'lookup'

/** Badge and explanation for a field that needs no lookup. Null when one is worth adding. */
export function autoMappingNote(
  via: AutoMappingVia | undefined,
): { label: string; title: string } | null {
  switch (via) {
    case 'identity':
      return {
        label: 'exact',
        title:
          'Sent under its canonical name, so it maps itself on the name alone. A lookup would add nothing.',
      }
    case 'dictionary':
      return {
        label: 'built-in',
        title:
          'Matched by the built-in dictionary of common field names, which applies to every foundation. A lookup here would shadow a global rule with a copy of itself.',
      }
    case 'lookup':
      return {
        label: 'learned',
        title: "Already in this foundation's lookup table — it will map itself next time.",
      }
    default:
      return null
  }
}

/** The canonical fields a blocker points at, for highlighting the mapping grid. */
export function blockedFieldKeys(blockers: Blocker[] | undefined): Set<string> {
  const keys = new Set<string>()
  for (const b of blockers ?? []) {
    if (b.severity !== 'blocking') continue
    for (const f of b.fields ?? []) keys.add(f.key)
  }
  return keys
}

// Nothing on an ingest row has its own column — the foundation's application
// reference, the organisation name and the rest are all just canonical fields. Read
// one back out of the stored mapping (sourceKey → canonical) plus the raw payload.
export function resolvedValue(
  row: { resolved: Record<string, string> | null; rawPayload: Record<string, unknown> },
  canonicalKey: string,
): string | null {
  const entry = Object.entries(row.resolved ?? {}).find(
    ([, canonical]) => canonical === canonicalKey,
  )
  if (!entry) return null
  const value = row.rawPayload[entry[0]]
  return value == null || value === '' ? null : String(value)
}

export function externalIdOf(row: IngestRow): string | null {
  return resolvedValue(row, 'externalApplicationId')
}

/** How long ago, in words. Queue rows are always read as "how stale is this". */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
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
  status: IngestStatus
  rawPayload: Record<string, unknown>
  proposed: Record<string, { sourceKey: string | null; confidence: number }> | null
  resolved: Record<string, string> | null
  // `awardId`, not `grantId` — this is the shape `computeGrantCandidates` stores and
  // `ResolveReportSchema` accepts. It was declared as `grantId` here, which silently
  // broke both ends: no candidate ever matched a grant in the picker (so nothing was
  // ever pre-selected or badged), and resolve posted a body the server ignored, so
  // every held report failed with "Grant not found for this client".
  matchCandidates: Array<{ awardId: string; score: number; reasons: string[] }> | null
  reportId: string | null
  createdAt: string
  client: { id: string; name: string }
  blockers: Blocker[]
  /** See `IngestRow.autoMappings` — same contract, report vocabulary. */
  autoMappings?: Record<string, { canonicalField: string; via: AutoMappingVia }>
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

// ─── Location probe ──────────────────────────────────────────────────────────
//
// Mirrors the shape of /api/admin/deprivation-probe. The main app owns the types
// (src/lib/deprivation, src/server/deprivation) and this app cannot import them —
// same constraint as the canonical field registry and the blocker codes — so this
// is a deliberate hand-kept copy. Keep it in step with the endpoint's response.

export type ProbeLevel = 'lsoa' | 'ward' | 'lad' | 'pfa' | 'region' | 'too_broad'

export interface ProbeResponse {
  input: string
  /** Null on the postcode branch, which never calls Google at all. */
  google:
    | {
        kind: 'match'
        name: string
        types: string[]
        extentKm: number
        partialMatch: boolean
        locationType: string | null
      }
    | { kind: 'no_match' }
    | { kind: 'unavailable'; reason: string }
    | null
  area: {
    wardName: string | null
    ladName: string | null
    region: string | null
    pfa: string | null
    country: string | null
  } | null
  level: ProbeLevel | null
  result:
    | { status: 'pending' }
    | {
        status: 'resolved'
        input: string
        areaName: string
        areaType: 'lsoa' | 'ward' | 'lad' | 'pfa' | 'region'
        nation: string
        vintage: string
        count: number
        min: number
        max: number
        median: number
        histogram: number[]
        regionName: string | null
        ladName: string | null
      }
    | { status: 'too_broad'; input: string; matchedName: string; extentKm: number }
    | { status: 'unresolvable'; input: string }
}

export function probeDeprivation(location: string): Promise<ProbeResponse> {
  return adminPost<ProbeResponse>('/api/admin/deprivation-probe', { location })
}
