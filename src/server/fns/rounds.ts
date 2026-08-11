import { conflict, forbidden, notFoundError } from '../../lib/errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, awards, roundProgrammes, rounds } from '../../../drizzle/schema'
import { requireAuthUser, requireRole } from '../session'
import { assertClientAccess } from '../scope'
import { SaveRoundSchema } from '../../lib/validators/round'

/**
 * The client's rounds. Archived ones are excluded unless asked for — an archived round
 * must not appear in the round pill or a filter, but the Rounds screen still has to be
 * able to show and un-archive it.
 */
export const listMyRounds = createServerFn({ method: 'GET' })
  .validator(z.object({ includeArchived: z.boolean().optional() }).optional())
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    if (!user.clientId) return []
    return getDb().query.rounds.findMany({
      where: (r, { eq, and, isNull }) =>
        data?.includeArchived
          ? eq(r.clientId, user.clientId!)
          : and(eq(r.clientId, user.clientId!), isNull(r.archivedAt)),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
      with: {
        roundProgrammes: {
          with: { programme: true },
          orderBy: (rp, { asc }) => [asc(rp.createdAt)],
        },
      },
    })
  })

/**
 * The Rounds screen's payload: every round the client has, each with the three figures
 * the comp shows — how many programmes it funds, what it has actually committed, and
 * the pot that is measured against.
 *
 * `committed` is money PROMISED, not money paid: the sum of live awards made from the
 * round. Cancelled awards are excluded because a cancelled grant frees its budget back
 * up, and a round that showed it as spent would under-report what is left to give.
 *
 * `budget` is DERIVED — the sum of the programme allocations, never a stored column.
 * A round funds programmes and nothing else, so there is no pot it could hold that its
 * allocations don't already describe. A round with no programmes reads as `null` rather
 * than £0, because "no budget set yet" and "a budget of nothing" are different answers
 * and only one of them is a reason to go and set one.
 */
export const listRoundsOverview = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []
  const db = getDb()

  const rows = await db.query.rounds.findMany({
    where: (r, { eq }) => eq(r.clientId, user.clientId!),
    orderBy: (r, { desc }) => [desc(r.openedAt), desc(r.createdAt)],
    with: { roundProgrammes: { columns: { id: true, budget: true } } },
  })
  if (rows.length === 0) return []

  const committedByRound = new Map<string, number>()
  const committed = await db
    .select({
      roundId: roundProgrammes.roundId,
      total: sql<string>`coalesce(sum(${awards.amountAwarded}), 0)`,
    })
    .from(awards)
    .innerJoin(applications, eq(awards.applicationId, applications.id))
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .where(
      and(
        inArray(
          roundProgrammes.roundId,
          rows.map((r) => r.id),
        ),
        ne(awards.status, 'cancelled'),
      ),
    )
    .groupBy(roundProgrammes.roundId)
  for (const row of committed) committedByRound.set(row.roundId, Number(row.total))

  return rows.map((round) => ({
    id: round.id,
    name: round.name,
    openedAt: round.openedAt,
    closedAt: round.closedAt,
    archivedAt: round.archivedAt,
    programmeCount: round.roundProgrammes.length,
    budget:
      round.roundProgrammes.length > 0
        ? round.roundProgrammes.reduce((sum, rp) => sum + Number(rp.budget), 0)
        : null,
    committed: committedByRound.get(round.id) ?? 0,
  }))
})

// Lightweight feed for the app-shell header's round-status line ("Spring 2026
// closed · Summer 2027 opens in 11 days") — names and dates only, no programmes.
export const listRoundDates = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireAuthUser()
  if (!user.clientId) return []
  return getDb().query.rounds.findMany({
    columns: { id: true, name: true, openedAt: true, closedAt: true },
    where: (r, { eq }) => eq(r.clientId, user.clientId!),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  })
})

export const getRound = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const round = await getDb().query.rounds.findFirst({
      where: (r, { eq }) => eq(r.id, data.id),
      with: {
        client: true,
        roundProgrammes: {
          with: { programme: true },
          orderBy: (rp, { asc }) => [asc(rp.createdAt)],
        },
      },
    })
    if (!round) throw notFoundError()
    assertClientAccess(user, round.clientId)
    return round
  })

/**
 * Everything the round dialog saves, in one call: the round's own fields plus the exact
 * set of programmes it funds. One server fn rather than the old
 * create-then-add-then-edit sequence, because the dialog presents it as one decision —
 * half-applying it would leave a round on screen that nobody asked for.
 *
 * A programme that has applications in this round CANNOT be dropped: its applications
 * point at the `round_programmes` row (ON DELETE RESTRICT), and they are the record of
 * what was judged against that budget. The refusal is explicit here rather than left to
 * the database, so the dialog can name the programme instead of surfacing a constraint.
 */
export const saveRound = createServerFn({ method: 'POST' })
  .validator(SaveRoundSchema)
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const db = getDb()

    let roundId = data.id
    let clientId: string
    if (roundId) {
      const existing = await db.query.rounds.findFirst({
        where: (r, { eq }) => eq(r.id, roundId!),
        columns: { clientId: true },
      })
      if (!existing) throw notFoundError()
      assertClientAccess(user, existing.clientId)
      clientId = existing.clientId
    } else {
      if (!user.clientId) throw forbidden()
      clientId = user.clientId
    }

    // Every programme named must belong to the same client — otherwise a crafted
    // request could staple another foundation's programme onto this round.
    if (data.programmes.length > 0) {
      const owned = await db.query.programmes.findMany({
        columns: { id: true },
        where: (p, { eq, and: andOp, inArray: inArrayOp }) =>
          andOp(
            eq(p.clientId, clientId),
            inArrayOp(
              p.id,
              data.programmes.map((p) => p.programmeId),
            ),
          ),
      })
      if (owned.length !== data.programmes.length) throw forbidden()
    }

    const values = {
      name: data.name,
      openedAt: new Date(data.openedAt),
      closedAt: new Date(data.closedAt),
    }
    if (roundId) {
      await db.update(rounds).set(values).where(eq(rounds.id, roundId))
    } else {
      const [created] = await db
        .insert(rounds)
        .values({ ...values, clientId })
        .returning({ id: rounds.id })
      roundId = created!.id
    }

    const current = await db.query.roundProgrammes.findMany({
      where: (rp, { eq }) => eq(rp.roundId, roundId!),
      with: { applications: { columns: { id: true }, limit: 1 } },
    })
    const wanted = new Map(data.programmes.map((p) => [p.programmeId, p]))

    const doomed = current.filter((rp) => !wanted.has(rp.programmeId))
    const undroppable = doomed.filter((rp) => rp.applications.length > 0)
    if (undroppable.length > 0) {
      const names = await db.query.programmes.findMany({
        columns: { name: true },
        where: (p, { inArray: inArrayOp }) =>
          inArrayOp(
            p.id,
            undroppable.map((rp) => rp.programmeId),
          ),
      })
      throw conflict(
        `${names.map((p) => p.name).join(', ')} already ${names.length === 1 ? 'has' : 'have'} applications in this round, so ${names.length === 1 ? 'it' : 'they'} cannot be removed from it. Set the budget to £0 to stop funding ${names.length === 1 ? 'it' : 'them'} instead.`,
      )
    }

    const statements = [
      ...doomed.map((rp) => db.delete(roundProgrammes).where(eq(roundProgrammes.id, rp.id))),
      ...current
        .filter((rp) => wanted.has(rp.programmeId))
        .map((rp) => {
          const next = wanted.get(rp.programmeId)!
          return db
            .update(roundProgrammes)
            .set({
              budget: next.budget.toString(),
              maxGrantAmount: next.maxGrantAmount?.toString() ?? null,
              grantDurationYears: next.grantDurationYears,
            })
            .where(eq(roundProgrammes.id, rp.id))
        }),
      ...data.programmes
        .filter((p) => !current.some((rp) => rp.programmeId === p.programmeId))
        .map((p) =>
          db.insert(roundProgrammes).values({
            roundId: roundId!,
            programmeId: p.programmeId,
            budget: p.budget.toString(),
            maxGrantAmount: p.maxGrantAmount?.toString() ?? null,
            grantDurationYears: p.grantDurationYears,
          }),
        ),
    ]
    // `db.batch` needs at least one statement, and a round whose programmes did not
    // change is an ordinary save (renaming it, moving its dates), not a no-op to guard.
    if (statements.length > 0) {
      await db.batch(statements as [(typeof statements)[number], ...typeof statements])
    }

    return { id: roundId }
  })

/**
 * Retire a round, or bring it back. See `setProgrammeArchived` — same rule, same
 * reason: a closed round's applications and awards are the record of a decision, so the
 * ordinary "we're finished with this" is archiving, not deletion.
 */
export const setRoundArchived = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), archived: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireRole('superadmin', 'admin')
    const existing = await getDb().query.rounds.findFirst({
      where: (r, { eq }) => eq(r.id, data.id),
      columns: { clientId: true },
    })
    if (!existing) throw notFoundError()
    assertClientAccess(user, existing.clientId)
    await getDb()
      .update(rounds)
      .set({ archivedAt: data.archived ? new Date() : null })
      .where(eq(rounds.id, data.id))
    return { ok: true }
  })
