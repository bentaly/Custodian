import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { auditLog, applications, roundProgrammes, programmes } from '../../drizzle/schema'

export type AuditAction =
  | 'application_awarded'
  | 'application_declined'
  | 'application_shortlisted'
  | 'application_commented'

/**
 * Record a human action against an application in the audit log — the source of the
 * dashboard "Lately" feed. Best-effort: any failure is swallowed so audit logging can
 * never break the primary action that triggered it.
 *
 * `clientId` is resolved from the application when the caller doesn't already have it
 * (the tenant is the application's owner, not the actor — so a superadmin acting across
 * tenants still logs to the right client's feed).
 */
export async function recordAudit(input: {
  actorUserId: string
  action: AuditAction
  applicationId: string
  clientId?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    let clientId = input.clientId
    if (!clientId) {
      const [row] = await getDb()
        .select({ clientId: programmes.clientId })
        .from(applications)
        .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
        .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
        .where(eq(applications.id, input.applicationId))
        .limit(1)
      if (!row) return
      clientId = row.clientId
    }
    await getDb().insert(auditLog).values({
      clientId,
      actorUserId: input.actorUserId,
      action: input.action,
      applicationId: input.applicationId,
      metadata: input.metadata ?? null,
    })
  } catch {
    // Audit logging is best-effort — never surface a logging failure to the caller.
  }
}
