import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { programmes, roundProgrammes } from '../../drizzle/schema'

type ScopedUser = { role: string; clientId: string | null }

/**
 * Guard a read/write keyed only by `applicationId`: resolve the owning client
 * (application → roundProgramme → programme) and assert the caller may access it.
 * Throws 'Not found' for a missing application, 'Forbidden' for a cross-client one.
 */
export async function assertApplicationAccess(
  user: ScopedUser,
  applicationId: string,
): Promise<void> {
  const app = await getDb().query.applications.findFirst({
    where: (a, { eq }) => eq(a.id, applicationId),
    with: { roundProgramme: { with: { programme: { columns: { clientId: true } } } } },
  })
  if (!app) throw new Error('Not found')
  assertClientAccess(user, app.roundProgramme.programme.clientId)
}

/**
 * Guard a fetch-by-id read: throw unless `resourceClientId` is the caller's own
 * client. Platform superadmins (no `clientId`) span all clients and pass through.
 * Mirrors the inline check in `deleteRound`. Pass the client a resource belongs
 * to (e.g. an application's `roundProgramme.programme.clientId`).
 */
export function assertClientAccess(
  user: ScopedUser,
  resourceClientId: string | null | undefined,
): void {
  if (user.role === 'superadmin') return
  if (!user.clientId || resourceClientId !== user.clientId) throw new Error('Forbidden')
}

/**
 * The set of `roundProgrammes.id` a user is allowed to see, used to tenant-scope
 * application listings.
 *
 * - `null` means "no restriction" — only platform superadmins, who legitimately
 *   span all clients.
 * - A (possibly empty) array restricts queries to the caller's own client.
 *   A non-superadmin with no `clientId` sees nothing (empty array), rather than
 *   falling through to an unscoped query.
 *
 * Callers should intersect this with any user-supplied round/programme filter so a
 * crafted `roundId` from another client can never widen visibility.
 */
export async function visibleRoundProgrammeIds(user: ScopedUser): Promise<string[] | null> {
  if (user.role === 'superadmin') return null
  if (!user.clientId) return []
  const rows = await getDb()
    .select({ id: roundProgrammes.id })
    .from(roundProgrammes)
    .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
    .where(eq(programmes.clientId, user.clientId))
  return rows.map((r) => r.id)
}

/**
 * Combine the caller's client scope (`visibleRoundProgrammeIds`) with an optional
 * user-supplied filter set.
 *
 * Returns the ids to restrict to, or `undefined` for "no restriction" (only when
 * the caller is unrestricted AND supplied no filter). An empty array means the
 * caller may see nothing matching.
 */
export function intersectScope(
  scope: string[] | null,
  filter: string[] | undefined,
): string[] | undefined {
  if (scope === null) return filter
  if (filter === undefined) return scope
  const scopeSet = new Set(scope)
  return filter.filter((id) => scopeSet.has(id))
}
