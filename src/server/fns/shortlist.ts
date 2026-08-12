import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationComments,
  applications,
  applicationVotes,
  awards,
  roundProgrammes,
  users,
} from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { intersectScope, visibleRoundProgrammeIds } from '../scope'

/**
 * Everything the Shortlist screen renders, in one call: the applications awaiting a
 * board decision, who is entitled to vote and how they have voted, and the budget the
 * decision is being made against.
 *
 * It is one server fn rather than four because the screen is a single decision surface
 * — the vote cards, the "one vote short" count and the headroom figure all have to
 * agree with each other, and fetching them separately is how they drift.
 */
export const listShortlist = createServerFn({ method: 'GET' })
  .validator(z.object({ roundId: z.uuid().optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()
    const db = getDb()

    let filterIds: string[] | undefined
    if (data.roundId) {
      const rows = await db
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, data.roundId))
      filterIds = rows.map((r) => r.id)
    }

    // Tenant scope (null = superadmin, unrestricted) intersected with the round filter,
    // so a roundId from another client can't widen what's returned.
    const roundProgrammeIds = intersectScope(await visibleRoundProgrammeIds(user), filterIds)
    const empty = {
      items: [],
      trustees: [],
      allowAdminVoting: false,
      budgets: [],
    }
    if (roundProgrammeIds !== undefined && roundProgrammeIds.length === 0) return empty

    const items = await db.query.applications.findMany({
      where: (a, { and, eq }) =>
        and(
          eq(a.status, 'shortlisted'),
          roundProgrammeIds ? inArray(a.roundProgrammeId, roundProgrammeIds) : undefined,
        ),
      with: { roundProgramme: { with: { programme: true, round: true } } },
      orderBy: (a, { desc, asc }) => [desc(a.custodianScore), asc(a.organisationName)],
    })
    if (items.length === 0) return empty

    const appIds = items.map((a) => a.id)
    const clientIds = [...new Set(items.map((a) => a.roundProgramme.programme.clientId))]
    // The shortlist is scoped to one client for everyone except a superadmin looking
    // across tenants; the trustee roster and voting policy only make sense for one, so
    // take the first (for a single-client caller it is the only one).
    const clientId = user.clientId ?? clientIds[0]!

    const [voteRows, trustees, profile, committedRows, commentRows] = await Promise.all([
      db
        .select({
          applicationId: applicationVotes.applicationId,
          userId: applicationVotes.userId,
          vote: applicationVotes.vote,
        })
        .from(applicationVotes)
        .where(inArray(applicationVotes.applicationId, appIds)),
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId)))
        .orderBy(users.name),
      db.query.clientProfiles.findFirst({ where: (p, { eq }) => eq(p.clientId, clientId) }),
      // What this round-programme has ALREADY committed. Headroom is meaningless
      // without it: a shortlist that fits the budget on its own may not fit what is
      // left of the budget, and that is precisely the question at a board meeting.
      db
        .select({
          roundProgrammeId: applications.roundProgrammeId,
          committed: sql<string>`coalesce(sum(${awards.amountAwarded}), 0)`,
        })
        .from(awards)
        .innerJoin(applications, eq(awards.applicationId, applications.id))
        .where(
          and(
            roundProgrammeIds
              ? inArray(applications.roundProgrammeId, roundProgrammeIds)
              : undefined,
            // A cancelled award is not money out of the door, so it must not eat
            // headroom the board could still spend.
            sql`${awards.status} <> 'cancelled'`,
          ),
        )
        .groupBy(applications.roundProgrammeId),
      // Just the count. The discussion itself is fetched when a card's comment button
      // is pressed — a board of ten applications would otherwise pull every thread on
      // every render to render a number.
      db
        .select({ applicationId: applicationComments.applicationId, comments: count() })
        .from(applicationComments)
        .where(inArray(applicationComments.applicationId, appIds))
        .groupBy(applicationComments.applicationId),
    ])

    const trusteeIds = new Set(trustees.map((t) => t.id))
    const votesByApp = new Map<string, Array<{ userId: string; vote: 'yes' | 'no' }>>()
    for (const v of voteRows) {
      // Only current trustees count towards the majority. A vote left behind by
      // somebody whose role changed stays in the table but must not tip a decision.
      if (!trusteeIds.has(v.userId)) continue
      const list = votesByApp.get(v.applicationId) ?? []
      list.push({ userId: v.userId, vote: v.vote })
      votesByApp.set(v.applicationId, list)
    }
    const committedByRp = new Map(
      committedRows.map((r) => [r.roundProgrammeId, parseFloat(r.committed)]),
    )
    const commentsByApp = new Map(commentRows.map((r) => [r.applicationId, r.comments]))

    const trusteeCount = trustees.length
    const decorated = items.map((a) => {
      const votes = votesByApp.get(a.id) ?? []
      const yesVotes = votes.filter((v) => v.vote === 'yes').length
      const noVotes = votes.length - yesVotes
      return {
        ...a,
        votes,
        yesVotes,
        noVotes,
        commentCount: commentsByApp.get(a.id) ?? 0,
        trusteeCount,
        hasMajority: trusteeCount > 0 && yesVotes * 2 > trusteeCount,
        // Whether one more yes would carry it — the "last vote needed" nudge.
        oneVoteShort:
          trusteeCount > 0 && (yesVotes + 1) * 2 > trusteeCount && yesVotes * 2 <= trusteeCount,
      }
    })

    // Budget per round-programme that the shortlist actually touches. Programmes with
    // no shortlisted application aren't part of this decision, so they'd be noise.
    const budgets = [
      ...new Map(
        items.map((a) => [
          a.roundProgrammeId,
          {
            roundProgrammeId: a.roundProgrammeId,
            programmeName: a.roundProgramme.programme.name,
            // The programme's own colour, so its swatch here is the one it wears on the
            // Programmes screen. Nullable for rows predating the column — the client
            // falls back through `resolveProgrammeColour`.
            programmeColour: a.roundProgramme.programme.colour,
            roundName: a.roundProgramme.round.name,
            budget: a.roundProgramme.budget ? parseFloat(a.roundProgramme.budget) : null,
            committed: committedByRp.get(a.roundProgrammeId) ?? 0,
            proposed: 0,
          },
        ]),
      ).values(),
    ]
    for (const a of items) {
      const row = budgets.find((b) => b.roundProgrammeId === a.roundProgrammeId)!
      row.proposed += parseFloat(a.amountRequested)
    }

    return {
      items: decorated,
      trustees,
      allowAdminVoting: profile?.allowAdminVoting ?? false,
      budgets,
    }
  })
