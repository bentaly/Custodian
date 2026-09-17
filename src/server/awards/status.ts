import { eq, inArray } from 'drizzle-orm'
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

/**
 * `recomputeAwardStatus` for several awards at once, for the bulk payment action.
 *
 * Same rule, same "write only on a transition", but in two round trips however many
 * awards there are: one relational query for all of them, and one `db.batch` holding
 * whatever updates the rule asks for. Calling the single version in a loop spent up to
 * two subrequests per award, and a page of 25 payments against 25 grants would pass the
 * 50-per-invocation cap halfway through, leaving some grants re-derived and some not.
 */
export async function recomputeAwardStatuses(awardIds: string[]): Promise<void> {
  if (awardIds.length === 0) return
  const db = getDb()
  const rows = await db.query.awards.findMany({
    where: inArray(awards.id, awardIds),
    columns: { id: true, status: true },
    with: {
      instalments: { columns: { paidDate: true } },
      schedule: { columns: { submittedDate: true } },
      reports: { columns: { reviewedAt: true, scheduleId: true, importBatchId: true } },
    },
  })
  const updates = rows.flatMap((award) => {
    const next = deriveAwardStatus(award.status, {
      instalments: award.instalments,
      milestones: award.schedule,
      reports: award.reports,
    })
    return next === award.status
      ? []
      : [db.update(awards).set({ status: next }).where(eq(awards.id, award.id))]
  })
  const [first, ...rest] = updates
  if (first) await db.batch([first, ...rest])
}
