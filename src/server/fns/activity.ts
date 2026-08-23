import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, desc, eq, gte, inArray, lte, isNotNull } from 'drizzle-orm'
import { getDb } from '../db'
import { auditLog, applications, users } from '../../../drizzle/schema'
import { requireRole } from '../session'
import { actionsInCategory, auditDetail, auditSubject, type AuditAction } from '../../lib/audit'

// The Activity screen: the whole audit log for one foundation, filtered and paged.
//
// Read-only by construction — there is no server fn here that writes or deletes, and
// there must never be one. `recordAudit` appends; a removed comment is recorded as its
// own entry rather than the original being erased, and a screen offering an edit would
// make the table worth exactly nothing.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export const ActivityFiltersSchema = z.object({
  page: z.number().int().min(1).default(1),
  // 10_000 is the export's reach — the whole filtered set in one file, since a
  // compliance file holding 25 of 4,000 rows would be worse than none.
  pageSize: z.number().int().min(1).max(10_000).default(25),
  category: z.enum(['decisions', 'money', 'reporting', 'access']).optional(),
  actorUserId: z.string().optional(),
  from: z.string().regex(ISO_DATE).optional(),
  to: z.string().regex(ISO_DATE).optional(),
})

export type ActivityFilters = z.infer<typeof ActivityFiltersSchema>

/**
 * A row as the screen receives it.
 *
 * `metadata` is rendered here rather than shipped: it is a free-form jsonb blob, so it
 * neither survives the serverFn boundary's serialisability check nor belongs on the
 * wire. `subject` and `detail` are the only things any reader wants from it, and
 * rendering once on the way out keeps the table and the CSV saying the same words.
 */
export type ActivityRow = {
  id: string
  action: AuditAction
  at: Date
  actorName: string | null
  applicationId: string | null
  /** The organisation, or — for an entry concerning no application — the invitee or key. */
  subject: string | null
  /** The stored extras in words, or '' where the entry has nothing to add. */
  detail: string
}

/**
 * One page of the log, newest first.
 *
 * Paged in SQL rather than in the client, unlike most list screens here: `audit_log`
 * only grows, it is the one table nothing ever prunes, and `audit_log_client_created_idx`
 * on `(client_id, created_at)` is exactly the index this ordering wants.
 */
export const listActivity = createServerFn({ method: 'GET' })
  .validator(ActivityFiltersSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')

    // A superadmin has no client of their own, and there is deliberately no
    // all-foundations view: the failure mode would be one foundation's decisions,
    // payments and invitations rendered on another's screen.
    if (!user.clientId) {
      return { items: [] as ActivityRow[], total: 0, page: data.page, pageSize: data.pageSize }
    }

    const where = and(
      eq(auditLog.clientId, user.clientId),
      data.category ? inArray(auditLog.action, actionsInCategory(data.category)) : undefined,
      data.actorUserId ? eq(auditLog.actorUserId, data.actorUserId) : undefined,
      data.from ? gte(auditLog.createdAt, new Date(`${data.from}T00:00:00.000Z`)) : undefined,
      // Inclusive of the whole end day: a range typed as 1–31 March means March, and
      // stopping at midnight on the 31st would silently drop that day's entries.
      data.to ? lte(auditLog.createdAt, new Date(`${data.to}T23:59:59.999Z`)) : undefined,
    )

    const [items, totals] = await Promise.all([
      getDb()
        .select({
          id: auditLog.id,
          action: auditLog.action,
          at: auditLog.createdAt,
          actorName: users.name,
          applicationId: auditLog.applicationId,
          organisationName: applications.organisationName,
          metadata: auditLog.metadata,
        })
        .from(auditLog)
        // Both joins are LEFT: an actor may have been deleted (the column is
        // `set null`, so the history survives the person), and an access entry
        // concerns no application at all.
        .leftJoin(users, eq(auditLog.actorUserId, users.id))
        .leftJoin(applications, eq(auditLog.applicationId, applications.id))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .offset((data.page - 1) * data.pageSize)
        .limit(data.pageSize),
      getDb().select({ total: count() }).from(auditLog).where(where),
    ])

    return {
      items: items.map(
        (r): ActivityRow => ({
          id: r.id,
          action: r.action,
          at: r.at,
          actorName: r.actorName,
          applicationId: r.applicationId,
          subject: r.organisationName ?? auditSubject(r.action, r.metadata),
          detail: auditDetail(r.action, r.metadata),
        }),
      ),
      total: totals[0]?.total ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    }
  })

/**
 * Everyone who appears in this client's log, for the actor filter.
 *
 * Read from the log itself rather than from the user list: somebody who has since left
 * the foundation still did the things they did, and dropping them from the filter would
 * quietly make their entries unfindable.
 */
export const listActivityActors = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireRole('superadmin', 'admin')
  if (!user.clientId) return [] as Array<{ id: string; name: string }>

  const rows = await getDb()
    .selectDistinct({ id: auditLog.actorUserId, name: users.name })
    .from(auditLog)
    .innerJoin(users, eq(auditLog.actorUserId, users.id))
    .where(and(eq(auditLog.clientId, user.clientId), isNotNull(auditLog.actorUserId)))

  return rows
    .filter((r): r is { id: string; name: string } => Boolean(r.id))
    .sort((a, b) => a.name.localeCompare(b.name))
})
