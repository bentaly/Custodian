// ─── Custodian score: shared types ───────────────────────────────────────────
//
// The "Custodian score" is the AI assessment of an application against the
// funder's mission (client level) and the programme's goal (programme level).
// These types are pure (no server/runtime dependencies) so they can be shared
// between the scoring logic, the database schema, and the UI.

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
 *   pending — not yet scored (scoring not configured, or never run)
 *   scored  — assessment completed successfully
 *   error   — scoring was attempted but failed (API/validation error)
 */
export type CustodianScoreStatus = 'pending' | 'scored' | 'error'

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
  /** Amount requested, in whole pounds. */
  amountRequested: number
  /** Geographic area the applicant covers — relevant when a programme has a
   *  geographic eligibility/priority. */
  geography: string | null | undefined
  /** Registered charity number, if any — an indicator of registration status.
   *  Bank details are intentionally NOT part of this input: they carry no scoring
   *  signal and are sensitive, so they are never sent to the model. */
  charityNumber: string | null | undefined
  /** Companies House number, if any. */
  companyNumber: string | null | undefined
  /** The applicant's answers to the dynamic form questions. */
  responses: Array<{ label: string; value: string }> | null | undefined
}
