import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, roundProgrammes } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'

export const listShortlist = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ roundId: z.uuid().optional() }))
  .handler(async ({ data }) => {
    await requireAuthUser()

    let roundProgrammeIds: string[] | undefined
    if (data.roundId) {
      const rows = await getDb()
        .select({ id: roundProgrammes.id })
        .from(roundProgrammes)
        .where(eq(roundProgrammes.roundId, data.roundId))
      roundProgrammeIds = rows.map((r) => r.id)
      if (roundProgrammeIds.length === 0) return []
    }

    return getDb().query.applications.findMany({
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
  })
