// ─── An application nobody filled in a form for ──────────────────────────────
//
// Two of the four routes from sourcing to an application skip the form: a partnership
// taken straight to the shortlist, and an EOI taken straight to the shortlist. Both
// write an ordinary `applications` row, because shortlisting, the round's budget, votes
// and the award all live there and nowhere else. This builds that row, once, so the two
// routes cannot drift apart in what they carry.
//
// What a form would have supplied and the application genuinely needs is asked for
// before this is called: the round, the amount, the purpose, and ideally the delivery
// area and an email. What it does not need (a budget breakdown, an organisation summary)
// only sharpens the assessment, and is left absent rather than invented. Bank details are
// added in Finance once the grant is awarded, as for any application missing them.
//
// The delivery area is resolved HERE, so the application lands with its deprivation
// reading and its place on the Insights map. It has to be: once trustees vote, an
// application's details lock, and a grant that reached the shortlist without its area
// could never be put on the map.

import { resolveDeprivation } from '../deprivation/run'
import { runDueDiligence } from '../dueDiligence/run'
import { deliveryGeoFromResult } from '../../lib/deprivation/types'
import type {
  DueDiligenceCheckRecord,
  DueDiligenceStatus,
  OrganisationProfile,
} from '../../lib/dueDiligence'
import type { CustodianScoreDetail, CustodianScoreStatus } from '../../lib/custodianScore/types'
import type { applications } from '../../../drizzle/schema'

export type SourcedApplicationInput = {
  roundProgrammeId: string
  organisationName: string
  contactEmail: string | null
  charityNumber: string | null
  companyNumber: string | null
  amount: number
  purpose: string | null
  proposedImpactQuantity: string | null
  deliveryArea: string | null
  /** What stands in for a form's answers, labelled as what it is. */
  responses: Array<{ label: string; value: string }>
  themes: string[] | null
  themesSetBy: string | null
  /** A result already on the partnership, or `run` to screen now (an EOI has none). */
  dueDiligence:
    | {
        status: DueDiligenceStatus
        checks: DueDiligenceCheckRecord[] | null
        checkedAt: Date | null
        profile: OrganisationProfile | null
      }
    | 'run'
  /** An assessment to carry over, or `queued` to have the application scored in its own right. */
  score:
    | {
        status: CustodianScoreStatus
        score: number | null
        detail: CustodianScoreDetail | null
        scoredAt: Date | null
      }
    | 'queued'
}

export async function sourcedApplicationValues(
  id: string,
  input: SourcedApplicationInput,
): Promise<typeof applications.$inferInsert> {
  const [screened, deprivation] = await Promise.all([
    input.dueDiligence === 'run'
      ? runDueDiligence({
          charityNumber: input.charityNumber,
          companyNumber: input.companyNumber,
          organisationName: input.organisationName,
          amountRequested: input.amount,
        }).then((r) => ({
          status: r.status,
          checks: r.checks,
          checkedAt: new Date(r.checkedAt),
          profile: r.profile,
        }))
      : Promise.resolve(input.dueDiligence),
    resolveDeprivation(input.deliveryArea),
  ])
  const attempted = deprivation.status !== 'pending'
  const geo = deliveryGeoFromResult(deprivation)
  const score = input.score === 'queued' ? null : input.score

  return {
    id,
    roundProgrammeId: input.roundProgrammeId,
    organisationName: input.organisationName,
    applicantEmail: input.contactEmail,
    charityNumber: input.charityNumber,
    companyNumber: input.companyNumber,
    deliveryArea: input.deliveryArea,
    amountRequested: String(input.amount),
    proposedImpactQuantity: input.proposedImpactQuantity,
    grantPurpose: input.purpose,
    responses: input.responses,
    themes: input.themes,
    themesSetBy: input.themesSetBy,
    dueDiligenceStatus: screened.status,
    dueDiligenceChecks: screened.checks,
    dueDiligenceCheckedAt: screened.checkedAt,
    organisationProfile: screened.profile,
    custodianScoreStatus: score ? score.status : 'queued',
    custodianScore: score?.score ?? null,
    custodianScoreDetail: score?.detail ?? null,
    custodianScoredAt: score?.scoredAt ?? null,
    deprivationStatus: deprivation.status,
    deprivationContext: attempted ? deprivation : null,
    deprivationResolvedAt: attempted ? new Date() : null,
    deliveryNation: geo.nation,
    deliveryRegion: geo.region,
    deliveryLadCode: geo.ladCode,
    deliveryLadName: geo.ladName,
  }
}
