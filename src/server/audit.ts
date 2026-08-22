import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { auditLog, applications, roundProgrammes, programmes } from '../../drizzle/schema'
import type { AuditAction } from '../lib/audit'

export type { AuditAction }

/**
 * What every audit row carries, whatever it is about.
 */
interface AuditBase {
  actorUserId: string
  action: AuditAction
  /** Small action-specific extras, so a reader can render without extra joins. */
  metadata?: Record<string, unknown>
}

/**
 * An audit row is scoped one of two ways, and the union is what keeps the second kind
 * honest.
 *
 * Most actions concern an application or the grant made from it, and the tenant is
 * resolved FROM that application (not from the actor — a superadmin acting across
 * tenants must still land on the right client's feed). But access and configuration
 * events — an API key, an invitation — belong to no application at all, and the log
 * would have nothing to resolve the tenant from.
 *
 * Rather than let `clientId` be optional everywhere and fail silently when neither is
 * known, the two shapes are separate: give an application, or give a client. There is
 * no third option, and the compiler says so at the call site.
 */
export type AuditInput = AuditBase &
  ({ applicationId: string; clientId?: string } | { applicationId?: undefined; clientId: string })

/**
 * Record a human action in the audit log — the source of the dashboard "Lately" feed,
 * and the record behind the app's audit-trail promise. Best-effort: any failure is
 * swallowed so audit logging can never break the primary action that triggered it.
 *
 * Nothing in the app deletes from this table. When the thing an entry describes is
 * itself removed — a deleted comment, a dropped reporting milestone — the removal is
 * recorded as its own entry rather than the original being erased.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    let clientId = input.clientId
    if (!clientId) {
      // Only reachable on the application-scoped branch: the union guarantees a
      // clientId whenever there is no application to resolve one from.
      const [row] = await getDb()
        .select({ clientId: programmes.clientId })
        .from(applications)
        .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
        .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
        .where(eq(applications.id, input.applicationId!))
        .limit(1)
      if (!row) return
      clientId = row.clientId
    }
    await getDb()
      .insert(auditLog)
      .values({
        clientId,
        actorUserId: input.actorUserId,
        action: input.action,
        applicationId: input.applicationId ?? null,
        metadata: input.metadata ?? null,
      })
  } catch {
    // Audit logging is best-effort — never surface a logging failure to the caller.
  }
}
