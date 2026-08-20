// ─── What a foundation owes in the coming week ───────────────────────────────
//
// Deliberately its own query rather than a reuse of `server/finance/query.ts`. That
// module answers "where is each GRANT's money up to" — one row per grant, rolled up.
// The digest asks a different question: which individual INSTALMENTS need paying, each
// with its own date and amount, because that is what a payment run consists of.
//
// The scoping rule here is the one that matters. Every other read in the app arrives
// with a session and goes through `visibleRoundProgrammeIds` / `assertClientAccess`.
// A cron has no session, so those helpers are not available and — more to the point —
// not applicable. This function therefore REQUIRES a clientId and filters on
// `awards.client_id` directly. There is deliberately no "all clients" variant to call
// by accident: the failure mode would be emailing one foundation's payment schedule to
// another foundation's finance officer.
import { and, asc, eq, isNull, lte, isNotNull } from 'drizzle-orm'
import {
  applications,
  awardInstalments,
  awards,
  programmes,
  roundProgrammes,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { addDaysIso, todayIso } from '../../lib/schedule'
import type { DigestItem } from '../../lib/financeDigest/types'

type Db = ReturnType<typeof getDb>

/**
 * Days ahead the digest looks. Seven, not `DUE_SOON_DAYS` (30): the Finance screen's
 * "due soon" is a planning horizon, whereas this email is the week's work. A month of
 * upcoming payments repeated every Monday is the same list four times, which is how a
 * recurring email teaches people it contains nothing new.
 */
export const DIGEST_WINDOW_DAYS = 7

export interface DigestWindow {
  /** Everything unpaid and dated before today, however old. */
  overdue: DigestItem[]
  /** Unpaid, dated today through today + `DIGEST_WINDOW_DAYS`. */
  dueThisWeek: DigestItem[]
}

/**
 * Outstanding instalments for one client, split at today.
 *
 * Undated ("TBC") instalments are excluded: they are outstanding money, and the
 * Finance screen counts them as `unscheduled` for exactly that reason, but they cannot
 * be *due this week* and repeating them in every weekly email would be noise that never
 * changes. Cancelled grants are excluded — there is nothing left to pay.
 */
export async function digestWindow(db: Db, clientId: string): Promise<DigestWindow> {
  const today = todayIso()
  const horizon = addDaysIso(today, DIGEST_WINDOW_DAYS)

  const rows = await db
    .select({
      awardId: awards.id,
      organisationName: applications.organisationName,
      programmeName: programmes.name,
      dueDate: awardInstalments.dueDate,
      amount: awardInstalments.amount,
      instalmentNo: awardInstalments.instalmentNo,
      bankStatus: applications.bankCheckStatus,
    })
    .from(awardInstalments)
    .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
    .innerJoin(applications, eq(applications.id, awards.applicationId))
    .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
    .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
    .where(
      and(
        eq(awards.clientId, clientId),
        eq(awards.status, 'active'),
        isNull(awardInstalments.paidDate),
        isNotNull(awardInstalments.dueDate),
        lte(awardInstalments.dueDate, horizon),
      ),
    )
    .orderBy(asc(awardInstalments.dueDate), asc(applications.organisationName))

  const items: DigestItem[] = rows.map((r) => ({
    awardId: r.awardId,
    organisationName: r.organisationName,
    programmeName: r.programmeName,
    dueDate: r.dueDate!,
    amount: Number(r.amount),
    instalmentNo: r.instalmentNo,
    // The STORED modulus verdict, same value the Finance list's Valid column sorts on
    // (written by `server/applications/bank.ts` on every path that sets the numbers).
    // Only a hard `invalid` is flagged — `unchecked` and NULL mean we never ran, which
    // is not news. Worth a line in the digest because a payment due Friday with
    // unpayable bank details is a problem to solve on Monday, not on Friday.
    bankFlagged: r.bankStatus === 'invalid',
  }))

  return {
    overdue: items.filter((i) => i.dueDate < today),
    dueThisWeek: items.filter((i) => i.dueDate >= today),
  }
}
