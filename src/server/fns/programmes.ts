import { conflict, forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { programmes, roundProgrammes } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import {
  CreateProgrammeSchema,
  UpdateProgrammeSchema,
  AddProgrammeToRoundSchema,
  UpdateRoundProgrammeSchema,
} from '../../lib/validators/programme'

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

export const getProgramme = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const programme = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: {
        roundProgrammes: { with: { round: true } },
      },
    })
    if (!programme) throw notFoundError()
    assertClientAccess(user, programme.clientId)
    return programme
  })

export const createProgramme = createServerFn({ method: 'POST' })
  .validator(CreateProgrammeSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    assertClientAccess(user, data.clientId)
    const [programme] = await getDb().insert(programmes).values(data).returning()
    return programme!
  })

export const updateProgramme = createServerFn({ method: 'POST' })
  .validator(UpdateProgrammeSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const { id, ...rest } = data
    const existing = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, id),
      columns: { clientId: true },
    })
    if (!existing) throw notFoundError()
    assertClientAccess(user, existing.clientId)
    const [programme] = await getDb()
      .update(programmes)
      .set(rest)
      .where(eq(programmes.id, id))
      .returning()
    return programme!
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

/**
 * Delete a programme outright. Only possible while it has no history — the moment an
 * application exists, `applications.round_programme_id` (ON DELETE RESTRICT) makes this
 * impossible at the database, and rightly so: an award's amount means nothing without
 * the programme budget it was set against. Archiving is the answer in that case, and
 * the error says so.
 */
export const deleteProgramme = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const programme = await getDb().query.programmes.findFirst({
      where: (p, { eq }) => eq(p.id, data.id),
      with: {
        roundProgrammes: {
          with: { applications: { columns: { id: true }, limit: 1 } },
        },
      },
    })
    if (!programme) throw notFoundError()
    assertClientAccess(user, programme.clientId)
    const hasApplications = programme.roundProgrammes.some((rp) => rp.applications.length > 0)
    if (hasApplications) {
      throw conflict(
        'This programme has applications, so it cannot be deleted. Archive it instead — it will disappear from the pickers but keep its history.',
      )
    }
    await getDb().delete(programmes).where(eq(programmes.id, data.id))
    return { ok: true }
  })

export const addProgrammeToRound = createServerFn({ method: 'POST' })
  .validator(AddProgrammeToRoundSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const { budget, maxGrantAmount, ...rest } = data
    // Both the round and the programme must belong to the caller's client; this
    // also prevents stitching a programme from one client onto another's round.
    const [round, programme] = await Promise.all([
      getDb().query.rounds.findFirst({
        where: (r, { eq }) => eq(r.id, rest.roundId),
        columns: { clientId: true },
      }),
      getDb().query.programmes.findFirst({
        where: (p, { eq }) => eq(p.id, rest.programmeId),
        columns: { clientId: true },
      }),
    ])
    if (!round || !programme) throw notFoundError()
    if (round.clientId !== programme.clientId) throw forbidden()
    assertClientAccess(user, round.clientId)
    const [link] = await getDb()
      .insert(roundProgrammes)
      .values({
        ...rest,
        budget: budget.toString(),
        maxGrantAmount: maxGrantAmount?.toString(),
      })
      .returning()
    return link!
  })

export const updateRoundProgramme = createServerFn({ method: 'POST' })
  .validator(UpdateRoundProgrammeSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const { id, budget, maxGrantAmount, ...rest } = data
    const existing = await getDb().query.roundProgrammes.findFirst({
      where: (rp, { eq }) => eq(rp.id, id),
      with: { programme: { columns: { clientId: true } } },
    })
    if (!existing) throw notFoundError()
    assertClientAccess(user, existing.programme.clientId)
    const [link] = await getDb()
      .update(roundProgrammes)
      .set({
        ...rest,
        budget: budget.toString(),
        ...(maxGrantAmount !== undefined
          ? { maxGrantAmount: maxGrantAmount.toString() }
          : { maxGrantAmount: null }),
      })
      .where(eq(roundProgrammes.id, id))
      .returning()
    return link!
  })

export const removeProgrammeFromRound = createServerFn({ method: 'POST' })
  .validator(z.object({ roundId: z.uuid(), programmeId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const existing = await getDb().query.roundProgrammes.findFirst({
      where: (rp, { eq, and: andOp }) =>
        andOp(eq(rp.roundId, data.roundId), eq(rp.programmeId, data.programmeId)),
      with: { programme: { columns: { clientId: true } } },
    })
    if (!existing) throw notFoundError()
    assertClientAccess(user, existing.programme.clientId)
    await getDb()
      .delete(roundProgrammes)
      .where(
        and(
          eq(roundProgrammes.roundId, data.roundId),
          eq(roundProgrammes.programmeId, data.programmeId),
        ),
      )
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
