import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { and, or, eq, ne, inArray, ilike } from 'drizzle-orm'
import { getDb } from '../db'
import { applications, awards, reports, programmes, rounds } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'
import { visibleRoundProgrammeIds } from '../scope'

const PER_GROUP = 5

export type SearchResultType = 'application' | 'award' | 'report' | 'programme' | 'round'

export type SearchResult = {
  type: SearchResultType
  /** The route param used to link to this result (application/award/report/programme/round id). */
  id: string
  title: string
  subtitle: string | null
  /** A short qualifier — a status, or "Ref <externalApplicationId>" when the match was on the ref. */
  badge: string | null
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

// App-wide autocomplete behind the header search box. Runs a handful of scoped,
// capped queries in parallel and returns a flat, typed list the dropdown groups by
// `type`. Tenant scope mirrors the list screens: applications/awards are gated by the
// caller's visible round-programmes; reports/programmes/rounds by clientId. A
// superadmin (null clientId, null scope) sees everything.
export const globalSearch = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ q: z.string().trim().min(1).max(100) }))
  .handler(async ({ data }): Promise<SearchResult[]> => {
    const user = await requireAuthUser()
    const like = `%${data.q}%`
    const clientId = user.clientId // null for superadmin → unrestricted

    const rpIds = await visibleRoundProgrammeIds(user) // string[] | null (null = unrestricted)
    // An empty (non-null) scope means the caller can see no applications/awards at all.
    const seesNothing = rpIds !== null && rpIds.length === 0
    const rpScope = rpIds ? inArray(applications.roundProgrammeId, rpIds) : undefined

    // Matches against an application row (used for both applications and awards).
    const appMatch = or(
      ilike(applications.organisationName, like),
      ilike(applications.externalApplicationId, like),
      ilike(applications.charityNumber, like),
      ilike(applications.companyNumber, like),
    )

    const [appRows, awardRows, reportRows, programmeRows, roundRows] = await Promise.all([
      seesNothing
        ? []
        : getDb().query.applications.findMany({
            // Awarded applications live in the Awards group; everything else here.
            where: and(rpScope, ne(applications.status, 'awarded'), appMatch),
            columns: { id: true, organisationName: true, status: true },
            with: {
              roundProgramme: {
                columns: { id: true },
                with: {
                  programme: { columns: { name: true } },
                  round: { columns: { name: true } },
                },
              },
            },
            orderBy: (a, { desc }) => [desc(a.submittedAt)],
            limit: PER_GROUP,
          }),
      seesNothing
        ? []
        : getDb().query.applications.findMany({
            where: and(rpScope, eq(applications.status, 'awarded'), appMatch),
            columns: { id: true, organisationName: true },
            with: {
              award: { columns: { id: true } },
              roundProgramme: {
                columns: { id: true },
                with: {
                  programme: { columns: { name: true } },
                  round: { columns: { name: true } },
                },
              },
            },
            orderBy: (a, { desc }) => [desc(a.decisionAt)],
            limit: PER_GROUP,
          }),
      getDb().query.reports.findMany({
        where: and(
          clientId ? eq(reports.clientId, clientId) : undefined,
          or(ilike(reports.organisationName, like), ilike(reports.externalApplicationId, like)),
        ),
        columns: { id: true, organisationName: true, programmeName: true },
        orderBy: (r, { desc }) => [desc(r.submittedAt)],
        limit: PER_GROUP,
      }),
      getDb().query.programmes.findMany({
        where: and(
          clientId ? eq(programmes.clientId, clientId) : undefined,
          ilike(programmes.name, like),
        ),
        columns: { id: true, name: true },
        limit: PER_GROUP,
      }),
      getDb().query.rounds.findMany({
        where: and(clientId ? eq(rounds.clientId, clientId) : undefined, ilike(rounds.name, like)),
        columns: { id: true, name: true },
        orderBy: (r, { desc }) => [desc(r.createdAt)],
        limit: PER_GROUP,
      }),
    ])

    const results: SearchResult[] = []

    for (const a of appRows) {
      const programmeName = a.roundProgramme?.programme?.name ?? null
      const roundName = a.roundProgramme?.round?.name ?? null
      results.push({
        type: 'application',
        id: a.id,
        title: a.organisationName,
        subtitle: [programmeName, roundName].filter(Boolean).join(' · ') || null,
        badge: statusLabel(a.status),
      })
    }

    for (const a of awardRows) {
      // An awarded application not yet backfilled with an award row can't be linked.
      if (!a.award) continue
      const programmeName = a.roundProgramme?.programme?.name ?? null
      const roundName = a.roundProgramme?.round?.name ?? null
      results.push({
        type: 'award',
        id: a.award.id,
        title: a.organisationName,
        subtitle: [programmeName, roundName].filter(Boolean).join(' · ') || null,
        badge: 'Award',
      })
    }

    for (const r of reportRows) {
      results.push({
        type: 'report',
        id: r.id,
        title: r.organisationName,
        subtitle: r.programmeName,
        badge: 'Report',
      })
    }

    for (const p of programmeRows) {
      results.push({ type: 'programme', id: p.id, title: p.name, subtitle: null, badge: 'Programme' })
    }

    for (const r of roundRows) {
      results.push({ type: 'round', id: r.id, title: r.name, subtitle: null, badge: 'Round' })
    }

    return results
  })
