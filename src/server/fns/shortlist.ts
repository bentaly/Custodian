import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applicationComments,
  applicationVotes,
  roundProgrammes,
  users,
} from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { intersectScope, visibleRoundProgrammeIds } from '../scope'
import { roundProgrammeSpend, roundProgrammeYear } from '../applications/roundSpend'
import { DEFAULT_FY_END_MONTH, type FinancialYear } from '../../lib/financialYear'
import { isSuggestedFirstYear, resolveFirstYearAmount } from '../../lib/multiYear'

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
    return shortlistData(db, roundProgrammeIds, user.clientId)
  })

/**
 * The shortlist, as a plain function of (connection, tenant, caller's client) — the
 * same seam Finance, Awards and Reports have, so everything below the auth check runs
 * without a session.
 *
 * Extracted so tenant isolation can be asserted on the rows this actually returns
 * (`src/server/tenancy.itest.ts`). `roundProgrammeIds` is already intersected with any
 * round filter by the caller; `undefined` is a superadmin, unrestricted, and an empty
 * array is the caller's short-circuit and must not reach here.
 *
 * `callerClientId` is separate from the scope because the trustee roster and the
 * voting policy belong to ONE foundation: a superadmin looking across tenants has no
 * client of their own, so the roster is taken from the applications in hand.
 */
export async function shortlistData(
  db: ReturnType<typeof getDb>,
  roundProgrammeIds: string[] | undefined,
  callerClientId: string | null,
) {
  {
    const empty = {
      items: [],
      trustees: [],
      allowAdminVoting: false,
      budgets: [],
      // Null rather than a default-derived year: there is no budget card to caption when
      // nothing is shortlisted, and inventing a year from the default end month would be
      // stating something about a foundation whose profile was never read.
      financialYear: null as FinancialYear | null,
    }
    // An empty (non-null) scope is a caller who can see nothing. The guard lives HERE
    // rather than in the handler, unlike the older extractions, because `inArray(x, [])`
    // is a SQL error and a guard a new caller has to remember is a guard that will be
    // forgotten.
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
    const clientId = callerClientId ?? clientIds[0]!

    // The year-end month, read before the rest because every cash figure below needs it —
    // the same reason `balanceAndBudget` reads the profile first. The YEAR itself is each
    // round's own (`roundFinancialYear`), not whichever one is current, so a round that
    // closed last March keeps being metered against last March.
    const fyProfile = await db.query.clientProfiles.findFirst({
      where: (p, { eq }) => eq(p.clientId, clientId),
      columns: { financialYearEndMonth: true },
    })
    const endMonth = fyProfile?.financialYearEndMonth ?? DEFAULT_FY_END_MONTH
    const roundProgrammeIdsInPlay = [...new Set(items.map((a) => a.roundProgrammeId))]
    const spend = await roundProgrammeSpend(db, roundProgrammeIdsInPlay, {
      financialYearEndMonth: endMonth,
    })
    // The card's caption names one year. Every application on a shortlist screen is in one
    // round, so in practice there is one; a superadmin looking across rounds gets the first.
    const fy = await roundProgrammeYear(db, roundProgrammeIdsInPlay[0]!, endMonth)

    const [voteRows, trustees, profile, commentRows] = await Promise.all([
      db
        .select({
          applicationId: applicationVotes.applicationId,
          userId: applicationVotes.userId,
          vote: applicationVotes.vote,
          recordedByUserId: applicationVotes.recordedByUserId,
        })
        .from(applicationVotes)
        .where(inArray(applicationVotes.applicationId, appIds)),
      db
        // `image` is the avatar URL on the row itself (`/api/avatar/…`), not a join —
        // the roster is a list of faces on the design, and initials are the fallback.
        .select({ id: users.id, name: users.name, image: users.image })
        .from(users)
        .where(and(eq(users.role, 'trustee'), eq(users.clientId, clientId)))
        .orderBy(users.name),
      db.query.clientProfiles.findFirst({ where: (p, { eq }) => eq(p.clientId, clientId) }),
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
    const votesByApp = new Map<
      string,
      Array<{ userId: string; vote: 'yes' | 'no'; recordedByUserId: string | null }>
    >()
    for (const v of voteRows) {
      // Only current trustees count towards the majority. A vote left behind by
      // somebody whose role changed stays in the table but must not tip a decision.
      if (!trusteeIds.has(v.userId)) continue
      const list = votesByApp.get(v.applicationId) ?? []
      list.push({ userId: v.userId, vote: v.vote, recordedByUserId: v.recordedByUserId })
      votesByApp.set(v.applicationId, list)
    }
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
        // What this ask draws from the round this year, and whether anyone has said so.
        // On the card beside the full ask: a trustee agreeing to a three-year grant must
        // see its whole size, and the board reading the budget meter must see what it
        // costs this year, and neither figure substitutes for the other.
        firstYearAmount: resolveFirstYearAmount({
          amountRequested: parseFloat(a.amountRequested),
          firstYearAmount: a.firstYearAmount === null ? null : parseFloat(a.firstYearAmount),
          grantDurationYears: a.roundProgramme.grantDurationYears,
        }),
        firstYearIsSuggested: isSuggestedFirstYear(a.firstYearAmount),
        trusteeCount,
        hasMajority: trusteeCount > 0 && yesVotes * 2 > trusteeCount,
        // Whether one more yes would carry it — the "last vote needed" nudge.
        oneVoteShort:
          trusteeCount > 0 && (yesVotes + 1) * 2 > trusteeCount && yesVotes * 2 <= trusteeCount,
      }
    })

    // Budget per round-programme that the shortlist actually touches. Programmes with
    // no shortlisted application aren't part of this decision, so they'd be noise.
    //
    // `committed` and `proposed` are THIS YEAR'S CASH, because that is what
    // `round_programmes.budget` counts — see `src/lib/multiYear.ts`. Both come from
    // `roundProgrammeSpend`, which is also what the budget ceiling in
    // `updateApplicationStatus` reads, so the meter and the gate cannot disagree about
    // whether there is room. The full committed values ride alongside for the card to
    // state beside them, never metered.
    const budgets = [
      ...new Map(
        items.map((a) => {
          const s = spend.get(a.roundProgrammeId)
          return [
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
              committed: s?.awardedThisYear ?? 0,
              proposed: s?.proposedThisYear ?? 0,
              /** The whole value of what is already awarded here, for context. */
              committedFull: s?.awardedFull ?? 0,
              /** The whole value of what this shortlist would commit, for context. */
              proposedFull: s?.proposedFull ?? 0,
            },
          ]
        }),
      ).values(),
    ]

    return {
      items: decorated,
      trustees,
      allowAdminVoting: profile?.allowAdminVoting ?? false,
      budgets,
      /** The year the round budgets above are being drawn from, for the card's caption. */
      financialYear: fy,
    }
  }
}
