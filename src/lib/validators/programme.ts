import { z } from 'zod'
import { IMPACT_UNIT_KEYS } from '../impactUnits'

/**
 * What the programme dialog saves. One schema for create and edit — `id` absent creates.
 *
 * `description` is deliberately absent: the dialog collects the programme's objectives,
 * criteria and priorities as one field (`goal`), which is both what a reader wants and
 * what the Custodian score is written against. Existing `description` values are left
 * untouched by a save rather than blanked.
 */
export const SaveProgrammeSchema = z
  .object({
    /** Absent creates a programme; present edits that one. */
    id: z.uuid().optional(),
    name: z.string().min(1, 'Give the programme a name').max(255),
    /** Objectives, criteria and priorities. Markdown from the rich text editor. */
    goal: z.string().max(20000).nullable(),
    tags: z.array(z.string().min(1).max(100)),
    impactUnit: z.enum(IMPACT_UNIT_KEYS as [string, ...string[]]),
    impactUnitLabel: z.string().max(200).nullable(),
  })
  .refine((p) => p.impactUnit !== 'other' || (p.impactUnitLabel?.trim() ?? '') !== '', {
    // Without this, picking "Other…" and typing nothing silently falls back to "People"
    // (see `impactUnitLabel()`), and the programme reports its impact in a unit nobody
    // chose — on Insights, and in the prompt that extracts figures from grant reports.
    message: 'Describe the unit this programme measures impact in',
    path: ['impactUnitLabel'],
  })
export type SaveProgrammeInput = z.infer<typeof SaveProgrammeSchema>
