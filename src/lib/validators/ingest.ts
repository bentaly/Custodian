import { z } from 'zod'

// Note: /api/apply has no envelope schema — the whole request body IS the payload (a
// flat object of the foundation's own field names → values, JSON or form-encoded), so
// there's nothing to validate at the door beyond "is it a non-empty object" (handled in
// the route). Meaningful validation happens downstream on the mapped canonical fields
// via CreateApplicationSchema.

// Admin resolves a needs_review ingest: `mapping` is canonicalField → sourceKey as
// chosen by the reviewer; `addToLookup` lists the canonical fields whose chosen
// mapping should be persisted to the foundation's lookup table. The resolving
// operator is taken from the Cloudflare Access identity header, not the body.
export const ResolveSchema = z.object({
  mapping: z.record(z.string(), z.string()),
  addToLookup: z.array(z.string()).default([]),
})
export type ResolveInput = z.infer<typeof ResolveSchema>

// Manually add/edit a single lookup-table entry from the admin app. The operator is
// taken from the Cloudflare Access identity header, not the body.
export const MappingSchema = z.object({
  clientId: z.uuid(),
  sourceKey: z.string().min(1),
  canonicalField: z.string().min(1),
  formType: z.enum(['application', 'report']).default('application'),
})
export type MappingInput = z.infer<typeof MappingSchema>

// Admin resolves a held report ingest: same shape as ResolveSchema plus the grant
// the reviewer matched the report to. Required when the resolve creates the
// submission (a submission cannot exist unlinked); omitted when confirming an
// ai_proposed row whose submission (and grant link) already exists.
export const ResolveReportSchema = z.object({
  mapping: z.record(z.string(), z.string()),
  addToLookup: z.array(z.string()).default([]),
  grantId: z.uuid().optional(),
})
export type ResolveReportInput = z.infer<typeof ResolveReportSchema>
