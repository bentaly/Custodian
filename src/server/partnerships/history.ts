// ─── "Have we met these people before?" ──────────────────────────────────────
//
// Nothing in the schema links records as "the same organisation": every partnership,
// application and award carries its own charity and company number as plain text. So a
// repeat grantee logged as a new partner starts with a blank history, and the three
// years of funding behind them live in whoever remembers.
//
// This is the join that was missing, made on the only key there is: the registration
// numbers. It answers two questions at the moment a partner is logged, and again on the
// record: is this organisation already in the pipeline (or was it turned down), and what
// have we awarded it before.
//
// **Matched on numbers only, never on names.** A name match is a guess ("St Mary's"), a
// number is the register's own key. An organisation with neither number has no history
// here, which is honest: we cannot tell.
//
// Tenancy is `client_id`, on both queries. `awards.client_id` is on the row.

import { and, desc, eq, inArray, ne, or, type SQL } from 'drizzle-orm'
import { getDb } from '../db'
import {
  applications,
  awards,
  partnerships,
  programmes,
  roundProgrammes,
} from '../../../drizzle/schema'
import { normaliseCompanyNumber } from '../dueDiligence/run'

/** A number as it may have been typed: as given, zero-padded, and with the zeros off. */
function spellings(raw: string | null | undefined, company: boolean): string[] {
  const trimmed = raw?.trim()
  if (!trimmed) return []
  const out = new Set([trimmed, trimmed.toUpperCase()])
  if (company) {
    const padded = normaliseCompanyNumber(trimmed)
    if (padded) {
      out.add(padded)
      out.add(padded.replace(/^0+/, ''))
    }
  }
  return [...out].filter(Boolean)
}

export type OrganisationHistory = Awaited<ReturnType<typeof organisationHistory>>

export async function organisationHistory(
  clientId: string,
  numbers: { charityNumber: string | null | undefined; companyNumber: string | null | undefined },
  /** The partnership being looked at, so it is not listed as its own duplicate. */
  excludePartnershipId?: string,
) {
  const charity = spellings(numbers.charityNumber, false)
  const company = spellings(numbers.companyNumber, true)
  if (charity.length === 0 && company.length === 0) return { partnerships: [], awards: [] }

  const db = getDb()
  const sameOrganisation = (
    charityColumn: typeof partnerships.charityNumber | typeof applications.charityNumber,
    companyColumn: typeof partnerships.companyNumber | typeof applications.companyNumber,
  ): SQL =>
    or(
      charity.length ? inArray(charityColumn, charity) : undefined,
      company.length ? inArray(companyColumn, company) : undefined,
    )!

  const [partnershipRows, awardRows] = await Promise.all([
    db
      .select({
        id: partnerships.id,
        organisationName: partnerships.organisationName,
        status: partnerships.status,
        source: partnerships.source,
        archivedAt: partnerships.archivedAt,
        createdAt: partnerships.createdAt,
      })
      .from(partnerships)
      .where(
        and(
          eq(partnerships.clientId, clientId),
          sameOrganisation(partnerships.charityNumber, partnerships.companyNumber),
          excludePartnershipId ? ne(partnerships.id, excludePartnershipId) : undefined,
        ),
      )
      .orderBy(desc(partnerships.createdAt))
      .limit(10),
    db
      .select({
        id: awards.id,
        amountAwarded: awards.amountAwarded,
        status: awards.status,
        // When the grant was DECIDED. An imported grant was created the day of the
        // import, and "awarded last Tuesday" for a 2019 grant is the import's old bug.
        decidedAt: awards.decisionAt,
        programmeName: programmes.name,
      })
      .from(awards)
      .innerJoin(applications, eq(awards.applicationId, applications.id))
      .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
      .innerJoin(programmes, eq(roundProgrammes.programmeId, programmes.id))
      .where(
        and(
          eq(awards.clientId, clientId),
          sameOrganisation(applications.charityNumber, applications.companyNumber),
        ),
      )
      .orderBy(desc(awards.decisionAt))
      .limit(10),
  ])

  return { partnerships: partnershipRows, awards: awardRows }
}
