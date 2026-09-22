import { and, eq, ne, sql } from 'drizzle-orm'
import {
  applications,
  awardInstalments,
  awards,
  programmes,
  roundProgrammes,
  rounds,
} from '../../../drizzle/schema'
import type { getDb } from '../db'
import { grantCreditors, type CreditorGrant, type CreditorsReport } from '../../lib/grantCreditors'

type Db = ReturnType<typeof getDb>

/**
 * The year-end grant creditors report for one foundation. The rules are
 * `src/lib/grantCreditors.ts`; this only fetches.
 *
 * Every grant decided on or before the year end and not cancelled, with ALL its
 * instalments — including ones paid since — because "unpaid at the year end" is a
 * question about the paid DATE, which only the pure half can ask. Two statements in one
 * round trip, both scoped on `awards.client_id`.
 */
export async function grantCreditorsReport(
  db: Db,
  clientId: string,
  yearEnd: string,
): Promise<CreditorsReport> {
  const scope = and(
    eq(awards.clientId, clientId),
    ne(awards.status, 'cancelled'),
    sql`${awards.decisionAt}::date <= ${yearEnd}::date`,
  )

  const [grantRows, instalmentRows] = await db.batch([
    db
      .select({
        awardId: awards.id,
        organisationName: applications.organisationName,
        reference: applications.externalApplicationId,
        programmeName: programmes.name,
        roundName: rounds.name,
        decisionDate: sql<string>`to_char(${awards.decisionAt}, 'YYYY-MM-DD')`,
        amountAwarded: awards.amountAwarded,
      })
      .from(awards)
      .innerJoin(applications, eq(applications.id, awards.applicationId))
      .leftJoin(roundProgrammes, eq(roundProgrammes.id, applications.roundProgrammeId))
      .leftJoin(programmes, eq(programmes.id, roundProgrammes.programmeId))
      .leftJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
      .where(scope),
    db
      .select({
        awardId: awardInstalments.awardId,
        amount: awardInstalments.amount,
        dueDate: awardInstalments.dueDate,
        paidDate: awardInstalments.paidDate,
      })
      .from(awardInstalments)
      .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
      .where(scope),
  ])

  const byAward = new Map<string, CreditorGrant['instalments']>()
  for (const i of instalmentRows) {
    const list = byAward.get(i.awardId) ?? []
    list.push({ amount: Number(i.amount), dueDate: i.dueDate, paidDate: i.paidDate })
    byAward.set(i.awardId, list)
  }

  return grantCreditors(
    grantRows.map((g) => ({
      ...g,
      amountAwarded: Number(g.amountAwarded),
      instalments: byAward.get(g.awardId) ?? [],
    })),
    yearEnd,
  )
}
