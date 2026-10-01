import { and, desc, eq, notInArray } from 'drizzle-orm'
import { getDb } from './db'
import { auditLog, users } from '../../drizzle/schema'
import { actionsInCategory, auditDetail, type AuditAction } from '../lib/audit'

/**
 * One entry in an application's own Activity section.
 *
 * The same rows the Settings Activity screen lists, narrowed to one application, with
 * the reason somebody gave for a change carried whole (`note`) rather than folded into
 * the one-line `detail`, because here there is room to read it.
 */
export type ApplicationActivityRow = {
  id: string
  action: AuditAction
  at: Date
  actorName: string | null
  detail: string
  note: string | null
}

/** More than any application has gathered; a bound, so the read cannot grow without one. */
const LIMIT = 200

/**
 * What people have done to one application, newest first.
 *
 * Comments are left out: the discussion is its own section on the same screen, and
 * listing "commented" beside the comment itself says everything twice.
 *
 * The caller has already established that the user may see the application, and that
 * they are an admin: the audit log is admin-only wherever it is shown.
 */
export async function applicationActivity(
  applicationId: string,
): Promise<ApplicationActivityRow[]> {
  const rows = await getDb()
    .select({
      id: auditLog.id,
      action: auditLog.action,
      at: auditLog.createdAt,
      actorName: users.name,
      metadata: auditLog.metadata,
    })
    .from(auditLog)
    // LEFT: an actor may have been removed since (the column is `set null`).
    .leftJoin(users, eq(auditLog.actorUserId, users.id))
    .where(
      and(
        eq(auditLog.applicationId, applicationId),
        notInArray(auditLog.action, actionsInCategory('comments')),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(LIMIT)

  return rows.map((r) => {
    const note = r.metadata?.['note']
    return {
      id: r.id,
      action: r.action,
      at: r.at,
      actorName: r.actorName,
      // Without the note: it is shown in full beneath, not clipped into this line.
      detail: auditDetail(r.action, r.metadata ? { ...r.metadata, note: undefined } : r.metadata),
      note: typeof note === 'string' && note.trim() ? note.trim() : null,
    }
  })
}
