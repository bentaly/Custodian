import type { CanonicalFieldKey } from './canonical'

/** A row from a foundation's lookup table: an incoming field name → canonical field. */
export interface FieldMappingEntry {
  sourceKey: string
  canonicalField: string
}

/** A canonical field that was resolved, and which source key supplied its value. */
export interface ResolvedField {
  sourceKey: string
  value: string
}

export interface LookupResult {
  /** Canonical fields resolved from the lookup table (or an exact-name identity match). */
  resolved: Partial<Record<CanonicalFieldKey, ResolvedField>>
  /** Required canonical fields still without a value — these gate promotion. */
  unresolvedRequired: CanonicalFieldKey[]
  /** Payload keys that matched no canonical field — these flow into `responses`. */
  leftoverKeys: string[]
}

/** AI proposal for a single unresolved required field. */
export interface FieldProposal {
  sourceKey: string | null
  confidence: number
}

export type ProposalMap = Partial<Record<CanonicalFieldKey, FieldProposal>>
