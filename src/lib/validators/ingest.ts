import { z } from 'zod'

// Payload posted to /api/ingest by a foundation's form integration (Zapier etc.).
// `payload` is the raw form data with the foundation's own field names; the values
// arrive as arbitrary JSON (usually strings).
export const IngestSchema = z.object({
  roundProgrammeId: z.uuid(),
  externalApplicationId: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()),
})
export type IngestInput = z.infer<typeof IngestSchema>

// Admin resolves a needs_review ingest: `mapping` is canonicalField → sourceKey as
// chosen by the reviewer; `addToLookup` lists the canonical fields whose chosen
// mapping should be persisted to the foundation's lookup table.
export const ResolveSchema = z.object({
  mapping: z.record(z.string(), z.string()),
  addToLookup: z.array(z.string()).default([]),
  resolvedBy: z.string().optional(),
})
export type ResolveInput = z.infer<typeof ResolveSchema>

// Manually add/edit a single lookup-table entry from the admin app.
export const MappingSchema = z.object({
  clientId: z.uuid(),
  sourceKey: z.string().min(1),
  canonicalField: z.string().min(1),
  addedBy: z.string().optional(),
})
export type MappingInput = z.infer<typeof MappingSchema>
