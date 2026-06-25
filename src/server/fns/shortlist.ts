import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, count, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, applicationVotes, roundProgrammes, users } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { intersectScope, visibleRoundProgrammeIds } from '../scope'

export const listShortlist = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ roundId: z.uuid().optional() }))
  .handler(async ({ data }) => {
    const user = await requireAuthUser()

    let filterIds: string[] | undefined
    if (data.roundId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, data.roundId))
      filterIds = rows.map((r) => r.id)
    }

    // Tenant scope (null = superadmin, unrestricted) intersected with the round filter,
    // so a roundId from another client can't widen what's returned.
    const roundProgrammeIds = intersectScope(await visibleRoundProgrammeIds(user), filterIds)
    if (roundProgrammeIds !== undefined && roundProgrammeIds.length === 0) return []

    const items = await getDb().query.applications.findMany({
      where: (a, { and }) =>
        and(
          eq(a.status, 'shortlisted'),
          roundProgrammeIds ? inArray(a.roundProgrammeId, roundProgrammeIds) : undefined,
        ),
      with: {
        roundProgramme: { with: { programme: true, round: true } },
      },
      orderBy: (a, { desc, asc }) => [desc(a.custodianScore), asc(a.organisationName)],
    })

    if (items.length === 0) return []

    // Award generation requires a majority (> 50%) of the client's trustees to vote
    // yes, so surface yes-vote and trustee counts per application for the UI gate.
    const appIds = items.map((a) => a.id)
    const clientIds = [...new Set(items.map((a) => a.roundProgramme.programme.clientId))]

    const [yesRows, trusteeRows] = await Promise.all([
      getDb()
        .select({ applicationId: applicationVotes.applicationId, yes: count() })
        .from(applicationVotes)
        .where(and(inArray(applicationVotes.applicationId, appIds), eq(applicationVotes.vote, 'yes')))
        .groupBy(applicationVotes.applicationId),
      getDb()
        .select({ clientId: users.clientId, trustees: count() })
        .from(users)
        .where(and(eq(users.role, 'trustee'), inArray(users.clientId, clientIds)))
        .groupBy(users.clientId),
    ])

    const yesByApp = new Map(yesRows.map((r) => [r.applicationId, r.yes]))
    const trusteesByClient = new Map(trusteeRows.map((r) => [r.clientId, r.trustees]))

    return items.map((a) => {
      const yesVotes = yesByApp.get(a.id) ?? 0
      const trusteeCount = trusteesByClient.get(a.roundProgramme.programme.clientId) ?? 0
      return {
        ...a,
        yesVotes,
        trusteeCount,
        hasMajority: trusteeCount > 0 && yesVotes * 2 > trusteeCount,
      }
    })
  })
