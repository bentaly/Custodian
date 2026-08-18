// ─── Which incoming fields already map themselves ────────────────────────────
//
// The review queue offers a "lookup" tick beside every mapped field, meaning "teach
// this foundation's table so the same incoming field name maps itself next time".
// For most fields that is exactly the right offer. For some it is redundant, and
// worse than redundant — it implies the field needed teaching when nothing about it
// ever did:
//
//   identity   — the payload sent the field under its canonical name, so
//                `applyLookupOver` resolves it on the key alone.
//   dictionary — COMMON_MAPPINGS already resolves it, for EVERY foundation, with the
//                same standing as a per-client lookup. A per-client row here just
//                shadows a global rule with a copy of itself.
//   lookup     — this foundation's table already holds it; ticking rewrites the row
//                it already has.
//
// So the queue needs to know, for a given (source key → canonical field) pair, whether
// anything would resolve it without being taught. Keyed on the SOURCE KEY rather than
// reported per resolved field, because the reviewer can change any dropdown: the answer
// has to follow what they have currently selected, not how the pipeline happened to
// resolve the row when it arrived.
//
// Re-derived rather than stored, for the reasons `diagnose.ts` sets out — a stored
// column would go stale the moment the dictionary gained an alias. This calls the same
// functions the pipeline routes on (`matchCommonKey`, the canonical key set, the
// client's own rows); it does not restate their logic, and the order below mirrors
// `processIngest` exactly, so what this promises is what would actually happen.

import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { fieldMappings } from '../../../drizzle/schema'
import { CANONICAL_KEYS, matchCommonKey, type CanonicalFieldKey } from '../../lib/fieldMapping'
import {
  REPORT_CANONICAL_KEYS,
  type ReportCanonicalFieldKey,
} from '../../lib/fieldMapping/reportCanonical'
import { matchCommonReportKey } from '../../lib/fieldMapping/reportCommon'

/** How a source key resolves without anyone teaching it. */
export type AutoMappingVia = 'identity' | 'dictionary' | 'lookup'

export interface AutoMapping {
  canonicalField: string
  via: AutoMappingVia
}

/** Source key → what it maps to on its own. Absent means "this one needs teaching". */
export type AutoMappings = Record<string, AutoMapping>

/**
 * The pure half, over an arbitrary canonical vocabulary — applications and reports differ
 * only in their key set and their dictionary, exactly as `applyLookupOver` does.
 *
 * Precedence follows the pipeline: the client's own table runs first and wins, then the
 * identity match, then the built-in dictionary. Reporting a different winner from the one
 * the pipeline would pick would make the badge a lie in exactly the case that matters —
 * a foundation that has deliberately overridden a dictionary alias.
 */
export function autoMappingsOver<K extends string>(
  payloadKeys: string[],
  clientLookup: Map<string, string>,
  keys: readonly K[],
  matchCommon: (sourceKey: string) => K | null,
): AutoMappings {
  const keySet = new Set<string>(keys)
  const out: AutoMappings = {}
  for (const key of payloadKeys) {
    const learned = clientLookup.get(key)
    // A stored mapping naming a field the registry has since dropped resolves nothing,
    // so it must not be reported as though it would.
    if (learned && keySet.has(learned)) {
      out[key] = { canonicalField: learned, via: 'lookup' }
      continue
    }
    if (keySet.has(key)) {
      out[key] = { canonicalField: key, via: 'identity' }
      continue
    }
    const common = matchCommon(key)
    if (common) out[key] = { canonicalField: common, via: 'dictionary' }
  }
  return out
}

/** Application vocabulary. */
export function autoMappingsFor(
  payloadKeys: string[],
  clientLookup: Map<string, string>,
): AutoMappings {
  return autoMappingsOver<CanonicalFieldKey>(
    payloadKeys,
    clientLookup,
    CANONICAL_KEYS,
    matchCommonKey,
  )
}

/** Report vocabulary — its own registry and its own dictionary, same rules. */
export function autoMappingsForReports(
  payloadKeys: string[],
  clientLookup: Map<string, string>,
): AutoMappings {
  return autoMappingsOver<ReportCanonicalFieldKey>(
    payloadKeys,
    clientLookup,
    REPORT_CANONICAL_KEYS,
    matchCommonReportKey,
  )
}

/** The rows this module needs; a subset of an `application_ingests` row. */
export interface AutoMappableIngest {
  id: string
  clientId: string
  rawPayload: Record<string, unknown>
}

/** Every client's lookup table for one form type, in one query. */
async function loadClientLookups(
  clientIds: string[],
  formType: 'application' | 'report',
): Promise<Map<string, Map<string, string>>> {
  const byClient = new Map<string, Map<string, string>>()
  if (clientIds.length === 0) return byClient

  const learned = await getDb()
    .select({
      clientId: fieldMappings.clientId,
      sourceKey: fieldMappings.sourceKey,
      canonicalField: fieldMappings.canonicalField,
    })
    .from(fieldMappings)
    .where(and(inArray(fieldMappings.clientId, clientIds), eq(fieldMappings.formType, formType)))

  for (const row of learned) {
    const map = byClient.get(row.clientId) ?? new Map<string, string>()
    map.set(row.sourceKey, row.canonicalField)
    byClient.set(row.clientId, map)
  }
  return byClient
}

/**
 * Batched for a page of ingests: one query for every client on the page, rather than
 * one per row — the same shape as `diagnoseIngests`, and for the same reason.
 */
export async function autoMappingsForIngests(
  rows: AutoMappableIngest[],
): Promise<Map<string, AutoMappings>> {
  const byClient = await loadClientLookups([...new Set(rows.map((r) => r.clientId))], 'application')
  return new Map(
    rows.map((row) => [
      row.id,
      autoMappingsFor(Object.keys(row.rawPayload ?? {}), byClient.get(row.clientId) ?? new Map()),
    ]),
  )
}

/** The report twin. Reads the `report` half of the lookup table, never the application one. */
export async function autoMappingsForReportIngests(
  rows: AutoMappableIngest[],
): Promise<Map<string, AutoMappings>> {
  const byClient = await loadClientLookups([...new Set(rows.map((r) => r.clientId))], 'report')
  return new Map(
    rows.map((row) => [
      row.id,
      autoMappingsForReports(
        Object.keys(row.rawPayload ?? {}),
        byClient.get(row.clientId) ?? new Map(),
      ),
    ]),
  )
}
