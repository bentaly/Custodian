// ─── Lookup matcher ──────────────────────────────────────────────────────────
//
// Pure, network-free resolution of an incoming payload against a foundation's
// lookup table. A source key resolves to a canonical field either via a lookup
// entry or by being an exact canonical key itself (identity match). Required
// canonical fields left without a value gate promotion (→ review / AI fallback).

import {
  CANONICAL_KEYS,
  REQUIRED_CANONICAL_KEYS,
  type CanonicalFieldKey,
} from './canonical'
import type { FieldMappingEntry, LookupResult } from './types'

const CANONICAL_KEY_SET = new Set<string>(CANONICAL_KEYS)

/** Normalise an arbitrary JSON payload value to a trimmed string. */
export function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

export function applyLookup(
  payload: Record<string, unknown>,
  mappings: FieldMappingEntry[],
): LookupResult {
  const sourceToCanonical = new Map<string, CanonicalFieldKey>()
  for (const m of mappings) {
    if (CANONICAL_KEY_SET.has(m.canonicalField)) {
      sourceToCanonical.set(m.sourceKey, m.canonicalField as CanonicalFieldKey)
    }
  }

  const resolved: LookupResult['resolved'] = {}
  const leftoverKeys: string[] = []

  for (const [key, rawValue] of Object.entries(payload)) {
    const canonical =
      sourceToCanonical.get(key) ??
      (CANONICAL_KEY_SET.has(key) ? (key as CanonicalFieldKey) : undefined)

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

  const unresolvedRequired = REQUIRED_CANONICAL_KEYS.filter((k) => !resolved[k])
  return { resolved, unresolvedRequired, leftoverKeys }
}
