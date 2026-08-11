import { forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { programmes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { SaveProgrammeSchema } from '../../lib/validators/programme'

/**
 * The client's programmes. Archived ones are excluded unless asked for: an archived
 * programme must not appear in a picker or a filter, but the Programmes screen still
 * has to be able to show — and un-archive — it.
 */
export const listProgrammes = createServerFn({ method: 'GET' })
  .validator(z.object({ includeArchived: z.boolean().optional() }).optional())
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    if (!user.clientId) return []
    return getDb().query.programmes.findMany({
      where: (p, { eq, and, isNull }) =>
        data?.includeArchived
          ? eq(p.clientId, user.clientId!)
          : and(eq(p.clientId, user.clientId!), isNull(p.archivedAt)),
      with: {
        roundProgrammes: { with: { round: true } },
      },
      orderBy: (p, { asc }) => [asc(p.name)],
    })
  })

/**
 * Create or update a programme — the whole dialog in one call, the same shape as
 * `saveRound`. Which rounds a programme is funded in is NOT set here: that belongs to
 * the round, alongside the budget it is given, and lives in the round dialog.
 *
 * `description` is not in the payload and is never written. The dialog replaced it with
 * `goal`; leaving the column alone means a programme that had one keeps it instead of
 * having it silently blanked by the first save.
 */
export const saveProgramme = createServerFn({ method: 'POST' })
  .validator(SaveProgrammeSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()
    const values = {
      name: data.name,
      goal: data.goal,
      tags: data.tags,
      impactUnit: data.impactUnit,
      // Only meaningful for 'other'; cleared otherwise so a unit changed away from
      // "Other…" cannot leave a stale phrase behind to resurface if it changes back.
      impactUnitLabel: data.impactUnit === 'other' ? (data.impactUnitLabel?.trim() ?? null) : null,
    }

    if (data.id) {
      const existing = await db.query.programmes.findFirst({
        where: (p, { eq }) => eq(p.id, data.id!),
        columns: { clientId: true },
      })
      if (!existing) throw notFoundError()
      assertClientAccess(user, existing.clientId)
      await db.update(programmes).set(values).where(eq(programmes.id, data.id))
      return { id: data.id }
    }

    if (!user.clientId) throw forbidden()
    const [created] = await db
      .insert(programmes)
      .values({ ...values, clientId: user.clientId })
      .returning({ id: programmes.id })
    return { id: created!.id }
  })

/**
 * Retire a programme, or bring it back.
 *
 * This — not delete — is the ordinary way to stop offering a programme. Archiving keeps
 * every application, award and budget that references it intact and readable, while
 * removing it from the pickers and filters where it would otherwise invite new work.
 * It is reversible, which is the whole point: "we're not running this again" is a
 * decision foundations revisit.
 */
export const setProgrammeArchived = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const existing = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      columns: { clientId: true },
    })
    if (!existing) throw notFoundError()
    assertClientAccess(user, existing.clientId)
    await getDb()
      .update(programmes)
      .set({ archivedAt: data.archived ? new Date() : null })
      .where(eq(programmes.id, data.id))
    return { ok: true }
  })

export const listClientTags = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []

  const clientProgrammes = await getDb().query.programmes.findMany({
    where: (p, { eq }) => eq(p.clientId, user.clientId!),
  })

  const tagSet = new Set<string>()
  for (const prog of clientProgrammes) {
    for (const tag of (prog.tags ?? []) as string[]) {
      if (tag) tagSet.add(tag)
    }
  }
  return Array.from(tagSet).sort()
})
