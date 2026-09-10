// ─── Custodian score: shared types ───────────────────────────────────────────
//
// The "Custodian score" is the AI assessment of an application against the
// funder's mission (client level) and the programme's goal (programme level).
// These types are pure (no server/runtime dependencies) so they can be shared
// between the scoring logic, the database schema, and the UI.

import type { BudgetLine } from '../budget/types'
import type { DeprivationResult } from '../deprivation/types'
import type { OrganisationProfile } from '../dueDiligence/types'

/**
 * The criteria the model scores each application against. Adding a criterion
 * means adding a key here and an entry in definitions.ts — the type system then
 * forces the registry, the prompt, and the parser to stay in sync.
 */
export type CriterionKey =
  | 'strategic_alignment'
  | 'community_need'
  | 'track_record'
  | 'budget_quality'
  | 'delivery_risk'
  | 'additionality'

/** A single criterion's outcome: a 1–10 score plus the model's one-line reasoning. */
export interface CriterionScore {
  /** 1 (poor) – 10 (excellent). */
  score: number
  /** Short justification for this score, grounded in the application. */
  rationale: string
}

/**
 * Overall scoring state stored on the application row.
 *   pending — no score and none is coming: scoring is not configured, or the row
 *             predates scoring. `runCustodianScore` returns this when there is no
 *             ANTHROPIC_API_KEY.
 *   queued  — the application exists and a score has been asked for but has not
 *             arrived. Only ever written by the create path; `runCustodianScore`
 *             never returns it, because by the time the runner has an answer the
 *             waiting is over. Kept distinct from `pending` so a screen can say
 *             "scoring" without saying it forever in an environment where scoring
 *             will never happen.
 *   scored  — assessment completed successfully
 *   error   — scoring was attempted but failed (API/validation error)
 */
export type CustodianScoreStatus = 'pending' | 'queued' | 'scored' | 'error'

/**
 * The detail blob persisted alongside the denormalised composite score. The
 * composite (0–100) and status live in their own columns for cheap list reads
 * and sorting; everything else lives here.
 */
export interface CustodianScoreDetail {
  /** Per-criterion 1–10 scores keyed by CriterionKey. */
  criteria: Record<CriterionKey, CriterionScore>
  /** The "AI assessment summary" prose shown on the application detail screen. */
  summary: string
  /** Specific concerns the reviewer should check (e.g. budget irregularities). */
  flags: string[]
  /** Exact model id used, for auditability when the prompt/model is tuned. */
  model: string
  /** Populated only when status is 'error' — the reason scoring failed. */
  error?: string
}

/** The full result returned by the orchestrator. */
export interface CustodianScoreResult {
  status: CustodianScoreStatus
  /** Composite 0–100, or null when not scored. */
  score: number | null
  detail: CustodianScoreDetail | null
  /**
   * One sentence saying what the money would fund — see `applications.grantPurpose`.
   * Deliberately OUTSIDE `detail`: it is not part of the assessment (it makes no
   * judgement), it lives in its own column, and it is the one thing here that ends up
   * in a letter to a grantee. Null unless status is 'scored'.
   */
  grantPurpose: string | null
  scoredAt: string
}

/** Context fed to the model: the funder's mission, the programme, the application. */
export interface CustodianScoreInput {
  /** Client-level mission statement (clientProfiles.missionStatement). */
  missionStatement: string | null | undefined
  /** Programme name for orientation. */
  programmeName: string
  /** Programme-level goal (programmes.goal). */
  programmeGoal: string | null | undefined
  /** Programme description, if the goal is sparse. */
  programmeDescription: string | null | undefined
  /** Applicant organisation name. */
  organisationName: string
  /** The applicant's own description of their organisation, where the form asked for
   *  one. Before it was a canonical field this text reached the model anyway, as one
   *  more entry in `responses`; pulling it onto a column would have QUIETLY REMOVED it
   *  from the prompt, so it is passed explicitly and given a section of its own. */
  organisationSummary: string | null | undefined
  /** Amount requested, in whole pounds. */
  amountRequested: number
  /** Unrestricted reserves as stated by the applicant, in pounds — read against the
   *  ask when judging need. Passed for the same reason as `organisationSummary`: it
   *  used to arrive as a response, and must not vanish from the prompt now that it
   *  has a column. Labelled in the prompt as the APPLICANT'S figure — no register
   *  publishes reserves, so nothing here is verified. */
  unrestrictedReserves: number | null | undefined
  /** The project budget as line items, when the foundation captured one. Signals
   *  whether the ask is costed credibly — and, where the lines exceed the ask, that
   *  this funder is being asked for part of a larger budget. */
  budgetBreakdown: BudgetLine[] | null | undefined
  /** Set when the foundation's form asked for the budget as a FILE rather than as
   *  fields. We can't read it, so it carries no budget content — its only job is to
   *  stop `budget_quality` reading an absent breakdown as costs the applicant failed
   *  to justify, when in fact they were never asked to itemise them. */
  budgetBreakdownLink: string | null | undefined
  /** Area where the project is delivered (community served) — relevant when a
   *  programme has a geographic eligibility/priority. */
  deliveryArea: string | null | undefined
  /**
   * The deprivation lookup's OWN verdict on `deliveryArea` — the decile spread and the
   * area it actually matched, not the applicant's words. Passed as the whole result
   * rather than a bare decile so the prompt can distinguish the four outcomes, which
   * mean different things and must never collapse into one: `resolved` is a measured
   * fact, `too_broad` and `unresolvable` are verdicts on the applicant's text, and
   * `pending`/null is "we have not looked yet". A missing decile is NOT evidence of an
   * affluent area, and the prompt says so — otherwise a geocoder outage reads to the
   * model as a community that does not need the money.
   */
  deprivation: DeprivationResult | null | undefined
  /** Registered charity number, if any — an indicator of registration status.
   *  Bank details are intentionally NOT part of this input: they carry no scoring
   *  signal and are sensitive, so they are never sent to the model. */
  charityNumber: string | null | undefined
  /** Companies House number, if any. */
  companyNumber: string | null | undefined
  /**
   * What the CHARITY REGISTER says the applicant is — filed income, headcounts, and the
   * charity's own account of its activities, captured by due diligence.
   *
   * The FIGURES are the one evidence here that nobody wrote to win the grant. The prose
   * `activities` field is not — the charity wrote that itself, for its regulator, often
   * years ago and very often as boilerplate from its governing document. So the two
   * halves are framed differently in the prompt and the prose carries its own hedge:
   * broad charitable objects must not read as alignment with this funder (they are
   * drafted to fit any funder), and a thin entry must not count against the applicant.
   *
   * Without the figures `track_record` and `delivery_risk` are scored entirely on the applicant's own prose,
   * and the model cannot see that a £250k ask is going to an organisation with £80k of
   * filed income. Labelled in the prompt as register-verified, in deliberate contrast to
   * `unrestrictedReserves` — and its `financialPeriodEnd` is stated alongside, because
   * these figures are routinely 12–18 months old and must not read as current.
   *
   * The due diligence VERDICT is deliberately not passed: it is already its own
   * indicator on the screen, and feeding it here too would let one fact move two
   * indicators with nothing saying they are the same fact. These are neutral figures.
   */
  organisationProfile: OrganisationProfile | null | undefined
  /**
   * The impact the applicant PROPOSES, counted in the programme's unit. `budget_quality`
   * is defined as whether the ask is "proportionate to the outcomes sought", and until
   * this was passed the outcomes sought sat in a column the prompt never read.
   *
   * The quantity and the unit are passed; the cost per unit is NOT computed for the
   * model. It has the ask and the quantity and can weigh them — handing it a derived
   * rate invites it to quote a figure as though it were the foundation's own.
   */
  proposedImpactQuantity: number | null | undefined
  /** The programme's impact unit key and its free-text label for 'other' — resolved
   *  through `impactUnitLabel` so the prompt names the unit the foundation chose. */
  impactUnit: string | null | undefined
  impactUnitLabel: string | null | undefined
  /**
   * How many years awards from this round-programme typically run. Delivery risk over
   * three years is a different judgement from the same plan over one.
   *
   * The round-programme BUDGET and `maxGrantAmount` are deliberately not passed. Telling
   * the model there is £200k in the programme against a £150k ask invites it to mark the
   * application down on affordability — which is none of the six criteria, and is the
   * foundation's decision, explicitly so since a round budget became a target rather
   * than a ceiling.
   */
  grantDurationYears: number | null | undefined
  /** The applicant's answers to the dynamic form questions. */
  responses: Array<{ label: string; value: string }> | null | undefined
}
