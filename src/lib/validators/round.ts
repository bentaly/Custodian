import { z } from 'zod'

/**
 * What the round dialog saves: the round itself plus the complete set of programmes it
 * funds. The programme list is a REPLACEMENT, not a patch — the dialog shows every
 * allocation at once, so anything missing from the array was removed on screen, and a
 * merge would quietly resurrect the row the admin just deleted.
 */
export const SaveRoundSchema = z
  .object({
    /** Absent creates a round; present edits that one. */
    id: z.uuid().optional(),
    name: z.string().min(1, 'Give the round a name').max(255),
    openedAt: z.string().min(1, 'Set the date the round opens'),
    closedAt: z.string().min(1, 'Set the date the round closes'),
    programmes: z.array(
      z.object({
        programmeId: z.uuid(),
        budget: z.number().nonnegative(),
        // Both optional, and `null` is meaningful: it clears a limit that was set.
        maxGrantAmount: z.number().positive().nullable(),
        grantDurationYears: z.number().int().positive().max(50).nullable(),
      }),
    ),
  })
  .refine((r) => r.closedAt >= r.openedAt, {
    message: 'The round cannot close before it opens',
    path: ['closedAt'],
  })
  .refine((r) => new Set(r.programmes.map((p) => p.programmeId)).size === r.programmes.length, {
    message: 'A programme can only be funded once in a round',
    path: ['programmes'],
  })
export type SaveRoundInput = z.infer<typeof SaveRoundSchema>
