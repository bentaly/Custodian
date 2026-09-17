import { and, count, eq, gt, isNull } from 'drizzle-orm'
import { getDb } from './db'
import {
  annualBudgetLines,
  annualBudgets,
  apiKeys,
  clientProfiles,
  invitations,
  programmes,
  rounds,
  users,
} from '../../drizzle/schema'
import { canSeePayments } from '../lib/roles'
import { currentVoterOf } from './members'
import { DEFAULT_FY_END_MONTH, financialYear } from '../lib/financialYear'
import { getRoundStatus } from '../lib/roundStatus'
import { settingsStatuses, type SettingsStatuses } from '../lib/settingsStatus'
import type { UserRole } from './session'

/**
 * The facts behind the Settings hub's status lines, in ONE `db.batch` (one subrequest).
 *
 * Every query runs for every caller, because a batch is one round trip whatever is in it,
 * and the role split is applied to the ANSWER: a trustee's response carries no key count,
 * no reply-to address and no budget, the same line the hub already draws around the
 * tiles themselves.
 */
export async function settingsStatusesFor(
  clientId: string,
  role: UserRole,
): Promise<SettingsStatuses> {
  const db = getDb()

  const [
    profileRows,
    programmeRows,
    roundRows,
    memberRows,
    voterRows,
    inviteRows,
    keyRows,
    budgetRows,
  ] = await db.batch([
    db
      .select({
        missionStatement: clientProfiles.missionStatement,
        enforceRoundBudget: clientProfiles.enforceRoundBudget,
        allowAdminVoting: clientProfiles.allowAdminVoting,
        replyTo: clientProfiles.awardLetterReplyTo,
        financialYearEndMonth: clientProfiles.financialYearEndMonth,
      })
      .from(clientProfiles)
      .where(eq(clientProfiles.clientId, clientId)),
    db
      .select({ n: count() })
      .from(programmes)
      .where(and(eq(programmes.clientId, clientId), isNull(programmes.archivedAt))),
    db
      .select({ openedAt: rounds.openedAt, closedAt: rounds.closedAt })
      .from(rounds)
      .where(and(eq(rounds.clientId, clientId), isNull(rounds.archivedAt))),
    db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.clientId, clientId), isNull(users.archivedAt))),
    // The size of the voting board, through the one predicate that decides it.
    db.select({ n: count() }).from(users).where(currentVoterOf(clientId)),
    db
      .select({ n: count() })
      .from(invitations)
      .where(
        and(
          eq(invitations.clientId, clientId),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      ),
    db
      .select({ n: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.clientId, clientId), isNull(apiKeys.revokedAt))),
    // A budget header with no lines is ignored everywhere it is read, so it does not
    // count as set here either: the inner join drops it.
    db
      .selectDistinct({ start: annualBudgets.financialYearStart })
      .from(annualBudgets)
      .innerJoin(annualBudgetLines, eq(annualBudgetLines.budgetId, annualBudgets.id))
      .where(eq(annualBudgets.clientId, clientId)),
  ])

  const profile = profileRows[0]
  const isAdmin = role === 'admin' || role === 'superadmin'
  const fy = financialYear(profile?.financialYearEndMonth ?? DEFAULT_FY_END_MONTH)

  return settingsStatuses({
    programmes: programmeRows[0]?.n ?? 0,
    rounds: roundRows.length,
    openRounds: roundRows.filter((r) => getRoundStatus(r) === 'open').length,
    members: memberRows[0]?.n ?? 0,
    budget: canSeePayments(role)
      ? { set: budgetRows.some((b) => b.start === fy.start), yearLabel: fy.label }
      : null,
    admin: isAdmin
      ? {
          hasGivingStrategy: !!profile?.missionStatement?.trim(),
          enforceRoundBudget: profile?.enforceRoundBudget ?? false,
          allowAdminVoting: profile?.allowAdminVoting ?? false,
          voters: voterRows[0]?.n ?? 0,
          replyTo: profile?.replyTo?.trim() || null,
          pendingInvitations: inviteRows[0]?.n ?? 0,
          activeApiKeys: keyRows[0]?.n ?? 0,
        }
      : null,
  })
}
