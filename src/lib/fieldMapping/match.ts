// ─── Lookup matcher ──────────────────────────────────────────────────────────
//
// Pure, network-free resolution of an incoming payload against a foundation's
// lookup table. A source key resolves to a canonical field either via a lookup
// entry or by being an exact canonical key itself (identity match). Required
// canonical fields left without a value gate promotion (→ review / AI fallback).

import { CANONICAL_KEYS, REQUIRED_CANONICAL_KEYS } from './canonical'
import type { FieldMappingEntry, LookupResult, ResolvedField } from './types'

/** Normalise an arbitrary JSON payload value to a trimmed string. */
export function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export interface GenericLookupResult<K extends string> {
  resolved: Partial<Record<K, ResolvedField>>
  unresolvedRequired: K[]
  leftoverKeys: string[]
}

/** The lookup matcher over an arbitrary canonical vocabulary — shared by the
 *  application and report pipelines, which differ only in their key sets. */
export function applyLookupOver<K extends string>(
  payload: Record<string, unknown>,
  mappings: FieldMappingEntry[],
  keys: readonly K[],
  requiredKeys: readonly K[],
): GenericLookupResult<K> {
  const keySet = new Set<string>(keys)
  const sourceToCanonical = new Map<string, K>()
  for (const m of mappings) {
    if (keySet.has(m.canonicalField)) {
      sourceToCanonical.set(m.sourceKey, m.canonicalField as K)
    }
  }

  const resolved: GenericLookupResult<K>['resolved'] = {}
  const leftoverKeys: string[] = []

  for (const [key, rawValue] of Object.entries(payload)) {
    const canonical =
      sourceToCanonical.get(key) ?? (keySet.has(key) ? (key as K) : undefined)

    if (!canonical) {
      leftoverKeys.push(key)
      continue
    }

    // A mapped/canonical key with an empty value doesn't resolve the field, but
    // it's still a canonical field — not a leftover/response. First value wins.
    const value = toStringValue(rawValue)
    if (value && !resolved[canonical]) {
      resolved[canonical] = { sourceKey: key, value }
    }
  }

  const unresolvedRequired = requiredKeys.filter((k) => !resolved[k])
  return { resolved, unresolvedRequired, leftoverKeys }
}

export function applyLookup(
  payload: Record<string, unknown>,
  mappings: FieldMappingEntry[],
): LookupResult {
  return applyLookupOver(payload, mappings, CANONICAL_KEYS, REQUIRED_CANONICAL_KEYS)
}
