import { eq } from 'drizzle-orm'
import { awards } from '../../../drizzle/schema'
import { deriveAwardStatus } from '../../lib/awardCompletion'
import { getDb } from '../db'

/**
 * Re-derive one award's lifecycle from its instalments, its reporting schedule and the
 * reports received against it, writing the result only when it actually changed.
 *
 * The IO half of `src/lib/awardCompletion.ts`, and the ONLY place that writes
 * `awards.status` outside the onboarding import. It exists because the rule now spans
 * three tables: "the last payment went out" used to be the whole story and could live
 * as four lines inside `setInstalmentPaid`, but a grant can now cross the line by a
 * report arriving, a milestone being removed, or somebody ticking Reviewed — and a
 * completed grant can cross back the other way when any of those is undone. Six
 * handlers call this; none of them restates the rule.
 *
 * Cheap on purpose: one relational query (a single round trip — the subrequest budget
 * is 50 per invocation and a submission already spends 13–20), and a second statement
 * only on an actual transition. It is safe to call after a write that changed nothing.
 *
 * Returns the status the award is now at, or null if there is no such award.
 */
export async function recomputeAwardStatus(
  awardId: string,
): Promise<'active' | 'completed' | 'cancelled' | null> {
  const award = await getDb().query.awards.findFirst({
    where: eq(awards.id, awardId),
    columns: { id: true, status: true },
    with: {
      instalments: { columns: { paidDate: true } },
      schedule: { columns: { submittedDate: true } },
      reports: { columns: { reviewedAt: true, scheduleId: true, importBatchId: true } },
    },
  })
  if (!award) return null

  const next = deriveAwardStatus(award.status, {
    instalments: award.instalments,
    milestones: award.schedule,
    reports: award.reports,
  })
  if (next !== award.status) {
    await getDb().update(awards).set({ status: next }).where(eq(awards.id, award.id))
  }
  return next
}
