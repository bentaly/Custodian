// ─── Which grants has which admin not been told about? ───────────────────────
//
// One query, across every tenant at once, for the same reason `takeCensus` is: this runs
// on a cron four times a day and most of those runs find nothing, so the cheap answer to
// "is there anything to do" has to cost one round trip rather than one per foundation.
//
// The result is a list of (award, recipient) PAIRS, which is the unit the receipt table
// is keyed on. Grouping into one email per person happens in `run.ts`.
import { and, asc, eq, gte, isNull, ne, sql } from 'drizzle-orm'
import {
  applications,
  awardNotificationSends,
  awards,
  clients,
  programmes,
  roundProgrammes,
  users,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { addDaysIso, todayIso } from '../../lib/schedule'
import type { AwardNotificationItem } from '../../lib/awardNotifications/types'

type Db = ReturnType<typeof getDb>

/**
 * How far back an unannounced award is still worth announcing.
 *
 * This is the SECOND of the two bounds, and it is not redundant with the receipt table.
 * The receipt answers "have we told this person"; on the very first run after deploy the
 * answer is no for every award the foundation has ever made, and without a window the
 * feature's opening act would be a message listing two hundred grants from 2019. It also
 * caps the damage from any future gap — a Worker that failed to run for a month comes
 * back and sends a week, not a month.
 *
 * Seven days against four ticks a day is 28 chances to deliver, so the window is nowhere
 * near tight enough to lose an award to a transient failure.
 */
export const AWARD_NOTIFICATION_WINDOW_DAYS = 7

export interface PendingAwardNotification {
  userId: string
  email: string
  recipientName: string
  clientId: string
  clientName: string
  role: (typeof users.$inferSelect)['role']
  awardNotifications: boolean | null
  item: AwardNotificationItem
}

/**
 * Every (award, admin) pair where the award is new, live, ours, and unannounced.
 *
 * Four filters, each doing something the others do not:
 *
 *  - **not already announced** (`sends.id is null`) — the idempotence. Re-running the
 *    endpoint by hand, or a redelivered cron, tells nobody anything twice.
 *  - **inside the window** — see `AWARD_NOTIFICATION_WINDOW_DAYS`.
 *  - **not cancelled** — a grant withdrawn before the next tick was never news.
 *  - **not imported** (`import_batch_id is null`) — THE one that would have caused real
 *    damage. Onboarding brings in a foundation's back catalogue as `awards` rows, and
 *    CLAUDE.md already lists "send award letters" and "write audit_log rows" as the two
 *    things an import must never do, for exactly this reason: 127 charities emailed
 *    about grants from 2019, or a feed claiming 127 awards were made today. An import
 *    creating 127 rows that each look "new" is the same mistake wearing a third hat, and
 *    the seven-day window would NOT have saved us, because the rows are created today.
 *
 * The role filter is deliberately absent: `wantsAwardNotifications` in `run.ts` is the
 * single statement of who may receive this, and splitting it across a WHERE clause and a
 * predicate is how the two drift apart.
 */
export async function pendingAwardNotifications(
  db: Db,
  opts: { onlyClientId?: string; windowDays?: number } = {},
): Promise<PendingAwardNotification[]> {
  const since = addDaysIso(todayIso(), -(opts.windowDays ?? AWARD_NOTIFICATION_WINDOW_DAYS))

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      recipientName: users.name,
      clientId: users.clientId,
      clientName: clients.name,
      role: users.role,
      awardNotifications: users.awardNotifications,
      awardId: awards.id,
      amount: awards.amountAwarded,
      startDate: awards.startDate,
      createdAt: awards.createdAt,
      organisationName: applications.organisationName,
      programmeName: programmes.name,
    })
    .from(awards)
    .innerJoin(applications, eq(applications.id, awards.applicationId))
    .innerJoin(users, eq(users.clientId, awards.clientId))
    .innerJoin(clients, eq(clients.id, awards.clientId))
    .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
    .leftJoin(
      awardNotificationSends,
      and(
        eq(awardNotificationSends.awardId, awards.id),
        eq(awardNotificationSends.userId, users.id),
      ),
    )
    .where(
      and(
        isNull(awardNotificationSends.id),
        gte(sql`${awards.createdAt}::date`, since),
        ne(awards.status, 'cancelled'),
        isNull(awards.importBatchId),
        eq(users.banned, false),
        isNull(users.archivedAt),
        opts.onlyClientId ? eq(awards.clientId, opts.onlyClientId) : undefined,
      ),
    )
    .orderBy(asc(awards.createdAt), asc(applications.organisationName))

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    recipientName: r.recipientName,
    clientId: r.clientId!,
    clientName: r.clientName,
    role: r.role,
    awardNotifications: r.awardNotifications,
    item: {
      awardId: r.awardId,
      organisationName: r.organisationName,
      programmeName: r.programmeName,
      amount: Number(r.amount),
      startDate: r.startDate,
      createdDate: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt))
        .toISOString()
        .slice(0, 10),
    },
  }))
}
