import {
  pgTable,
  pgEnum,
  text,
  boolean,
  timestamp,
  jsonb,
  uuid,
  numeric,
  integer,
  unique,
  index,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { DueDiligenceCheckRecord } from '../src/lib/dueDiligence/types'
import type { CustodianScoreDetail } from '../src/lib/custodianScore/types'
import type { DeprivationResult } from '../src/lib/deprivation/types'
import type { BudgetLine } from '../src/lib/budget/types'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', [
  'superadmin',
  'admin',
  'manager',
  'contributor',
  'observer',
  'trustee',
  'finance',
])

export const applicationVoteEnum = pgEnum('application_vote', ['yes', 'no'])

export const clientTypeEnum = pgEnum('client_type', [
  'charitable_foundation',
  'family_office',
])



export const applicationStatusEnum = pgEnum('application_status', [
  'for_review',
  'shortlisted',
  'awarded',
  'declined',
])

// Lifecycle of a grant (the live funding relationship that begins once an award is
// generated). Distinct from the application's status: an application is terminal at
// the decision, whereas a grant runs on — money is paid out over time.
//   active     — award generated; instalments outstanding or in progress
//   completed  — all instalments paid / the grant has run its course
//   cancelled  — the award was withdrawn after being generated
export const awardStatusEnum = pgEnum('award_status', [
  'active',
  'completed',
  'cancelled',
])

// Overall outcome of the automated due diligence screening for an application.
//   pending  — not yet run
//   clear    — all checks passed
//   warning  — one or more soft flags, no hard blocks
//   blocked  — at least one hard block (e.g. charity removed from register)
//   review   — could not screen automatically (API error, or org type with no API); needs manual review
export const dueDiligenceStatusEnum = pgEnum('due_diligence_status', [
  'pending',
  'clear',
  'warning',
  'blocked',
  'review',
])

// State of the AI "Custodian score" assessment for an application.
//   pending — not yet scored (scoring not configured, or never run)
//   scored  — assessment completed successfully
//   error   — scoring was attempted but failed (API/validation error); re-runnable
export const custodianScoreStatusEnum = pgEnum('custodian_score_status', [
  'pending',
  'scored',
  'error',
])

// How a submitted grant report was tied to its grant.
//   external_id — the report carried an externalApplicationId that exactly matched
//                 an application with a grant; linked automatically.
//   manual      — an admin picked the grant in the review queue (report arrived
//                 without a usable ID; heuristic candidates only ever suggest).
//   import      — created by the historical data-import flow (client-supplied link).
export const reportMatchMethodEnum = pgEnum('report_match_method', [
  'external_id',
  'manual',
  'import',
])

// State of the AI analysis of a submitted grant report (summary, alignment against
// the application's promises and the programme's goal, impact-quantity extraction).
//   pending  — not yet analysed (AI not configured, or never run); re-runnable
//   analysed — analysis completed successfully
//   error    — attempted but failed (API/validation error); re-runnable
export const reportAnalysisStatusEnum = pgEnum('report_analysis_status', [
  'pending',
  'analysed',
  'error',
])

// State of an incoming application payload as it moves through field mapping.
//   received     — raw payload persisted, mapping/scoring not yet run. The sender
//                  gets its 202 as soon as this row exists; the pipeline then runs
//                  in the background and moves the row to one of the states below.
//                  A row stuck here is a crashed pipeline — reprocessable, never lost.
//   needs_review — at least one required canonical field could not be confidently
//                  mapped (no lookup match, and AI either absent or below the
//                  confidence threshold); held in the admin review queue.
//   ai_proposed  — all required fields resolved, but at least one came from an AI
//                  proposal (above threshold). Promoted to a real application, and
//                  surfaced for a human to confirm + optionally persist the mapping.
//   complete     — all required fields resolved from the human-curated lookup table.
export const ingestStatusEnum = pgEnum('ingest_status', [
  'needs_review',
  'ai_proposed',
  'complete',
  'received',
])

// State of deprivation-context resolution for an application's free-text location.
//   pending      — no location on the application, or not yet resolved
//   resolved     — mapped to a small-area set; a decile range is available
//   too_broad    — matched a place too large to give a meaningful decile (e.g. "London")
//   unresolvable — no place matched (typo / unsupported area)
export const deprivationStatusEnum = pgEnum('deprivation_status', [
  'pending',
  'resolved',
  'too_broad',
  'unresolvable',
])

// Which nation's Index of Multiple Deprivation a reference row belongs to. Deciles are
// only comparable WITHIN a nation, so every reading is labelled with this.
export const deprivationNationEnum = pgEnum('deprivation_nation', [
  'england',
  'scotland',
  'wales',
  'northern_ireland',
])

// ─── Business tables ──────────────────────────────────────────────────────────

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: clientTypeEnum('type').notNull().default('charitable_foundation'),
  description: text('description'),
  website: text('website'),
  // Cloudflare Access email of the Canvas operator who provisioned this foundation
  // from the admin app (forwarded via x-admin-actor). Null for any other origin.
  createdByEmail: text('created_by_email'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// BetterAuth required fields (email_verified, image, updated_at) are included
// alongside the business fields from the data model. Auth plumbing only.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: userRoleEnum('role').notNull().default('observer'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // BetterAuth admin plugin — ban controls (unused for now, required by plugin schema)
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
  // BetterAuth required
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  openedAt: timestamp('opened_at'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const programmes = pgTable('programmes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  goal: text('goal'),
  tags: jsonb('tags').$type<string[]>(),
  // Unit this programme measures impact in (key from IMPACT_UNITS, e.g. 'people',
  // 'hectares'). Drives Insights aggregation and the report-analysis extraction
  // prompt ("how many {unit} does this report evidence").
  impactUnit: text('impact_unit').notNull().default('people'),
  // Free-text PLURAL noun phrase when impactUnit = 'other', e.g. "hectares of
  // peatland restored". Used verbatim for display and extraction; never inflected.
  impactUnitLabel: text('impact_unit_label'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const roundProgrammes = pgTable(
  'round_programmes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roundId: uuid('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    programmeId: uuid('programme_id')
      .notNull()
      .references(() => programmes.id, { onDelete: 'cascade' }),
    // Total pot available for this programme in this specific round, e.g. £500,000.
    // Tracked against shortlisted application amounts to show budget utilisation.
    budget: numeric('budget').notNull(),
    // The most any single applicant can be awarded, e.g. £50,000.
    // Shown to reviewers and used as a guardrail when assessing applications.
    maxGrantAmount: numeric('max_grant_amount'),
    // How many years awards from this round programme typically run, e.g. 3.
    // Used to show an annualised figure (max_grant_amount / years) alongside the total.
    grantDurationYears: integer('grant_duration_years'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique('round_programmes_uniq').on(t.roundId, t.programmeId)],
)

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundProgrammeId: uuid('round_programme_id')
    .notNull()
    .references(() => roundProgrammes.id, { onDelete: 'restrict' }),
  // The foundation's OWN application reference (distinct from our `id`). Set when
  // an application arrives via the field-mapping ingest path; nullable because
  // applications submitted directly (canonical form) have no external reference.
  externalApplicationId: text('external_application_id'),
  organisationName: text('organisation_name').notNull(),
  // Registration numbers drive due diligence routing. Both nullable: a CIO has
  // only a charity number, a CIC only a company number, and some entities are
  // dual-registered and have both.
  charityNumber: text('charity_number'),
  companyNumber: text('company_number'),
  bankName: text('bank_name'),
  bankAccountName: text('bank_account_name'),
  bankAccountNumber: text('bank_account_number'),
  bankSortCode: text('bank_sort_code'),
  amountRequested: numeric('amount_requested').notNull(),
  // The PROJECT budget as line items, in whole pounds. Nullable — not every
  // foundation collects one, and it is captured only when the incoming form has a
  // structured breakdown (a prose budget narrative stays in `responses`).
  // NB: these lines are NOT a decomposition of `amountRequested` and need not sum
  // to it — the applicant may be asking this funder to fund only part of the
  // budget. Never derive one from the other.
  budgetBreakdown: jsonb('budget_breakdown').$type<BudgetLine[]>(),
  // Free-text area where the funded PROJECT is delivered — the community served (e.g.
  // "Bradford", "BD1 1AA", "Yorkshire"), NOT where the organisation is based. Captured
  // from the incoming application; nullable as not every foundation collects it. Drives
  // the deprivation context below.
  // NB: the physical column keeps its original name `geography` (a logical-only rename,
  // to avoid a data-losing column rename migration); the app refers to it as deliveryArea.
  deliveryArea: text('geography'),
  responses: jsonb('responses').$type<Array<{ label: string; value: string }>>(),
  status: applicationStatusEnum('status').notNull().default('for_review'),
  // Summary outcome of the automated due diligence screening — cheap to read for
  // the applications list/detail indicator without parsing the checks array.
  dueDiligenceStatus: dueDiligenceStatusEnum('due_diligence_status').notNull().default('pending'),
  // Individual check results. `level` and `label` are intentionally NOT stored —
  // they are UI concerns derived from `key` via the definitions registry in
  // src/lib/dueDiligence. We persist only what was actually checked and its outcome.
  dueDiligenceChecks: jsonb('due_diligence_checks').$type<DueDiligenceCheckRecord[]>(),
  dueDiligenceCheckedAt: timestamp('due_diligence_checked_at'),
  // AI "Custodian score" assessment. `custodianScore` is the denormalised
  // composite (0–100) kept in its own column for cheap list reads and sorting;
  // the per-criterion breakdown, summary, and flags live in `custodianScoreDetail`.
  custodianScoreStatus: custodianScoreStatusEnum('custodian_score_status').notNull().default('pending'),
  custodianScore: integer('custodian_score'),
  custodianScoreDetail: jsonb('custodian_score_detail').$type<CustodianScoreDetail>(),
  custodianScoredAt: timestamp('custodian_scored_at'),
  // Deprivation context derived from `deliveryArea`. `deprivationStatus` is the
  // denormalised outcome for cheap list reads; `deprivationContext` holds the full
  // result (decile range, nation, vintage, matched area — or the reason it could not
  // be resolved). Decile data itself comes from our own `deprivation_areas` table
  // (latest per-nation index), NOT from the geocoding API.
  deprivationStatus: deprivationStatusEnum('deprivation_status').notNull().default('pending'),
  deprivationContext: jsonb('deprivation_context').$type<DeprivationResult>(),
  deprivationResolvedAt: timestamp('deprivation_resolved_at'),
  // Administrative location of the delivery area, captured during deprivation
  // resolution (from the matched small area / reverse geocode) — independent of the
  // decile, for portfolio breakdowns like "funding by region / district". Region is
  // England's 9 regions ("Wales" for Welsh areas); null for Scotland/NI (group those
  // by nation). District (LAD) is null for region-level matches that span many LADs.
  deliveryNation: deprivationNationEnum('delivery_nation'),
  deliveryRegion: text('delivery_region'),
  deliveryLadCode: text('delivery_lad_code'),
  deliveryLadName: text('delivery_lad_name'),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  decisionAt: timestamp('decision_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── BetterAuth tables ────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // BetterAuth admin plugin — set to the admin's user id while impersonating
  impersonatedBy: text('impersonated_by'),
})

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
})

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: userRoleEnum('role').notNull().default('observer'),
  token: text('token').notNull().unique(),
  // Nullable: invites created from the (token-gated) admin app have no main-app
  // user to attribute. In-app invites still set this to the inviting user.
  invitedBy: text('invited_by').references(() => users.id, { onDelete: 'cascade' }),
  // Cloudflare Access email of the admin-app operator, when invitedBy is null.
  invitedByEmail: text('invited_by_email'),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const clientProfiles = pgTable('client_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: 'cascade' }),
  missionStatement: text('mission_statement'),
  // When true, admins may record votes on behalf of trustees (see castVote).
  allowAdminVoting: boolean('allow_admin_voting').notNull().default(false),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Field mapping (application ingest) ─────────────────────────────────────────

// Per-foundation lookup of an incoming form's field name (`sourceKey`) to one of
// our canonical fields. Only human-confirmed mappings live here — AI proposals are
// never auto-persisted; an admin confirms one before it joins the table.
export const fieldMappings = pgTable(
  'field_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    sourceKey: text('source_key').notNull(),
    canonicalField: text('canonical_field').notNull(),
    // Which form's canonical vocabulary this mapping targets: 'application' or
    // 'report'. The same sourceKey can legitimately map differently per form —
    // e.g. "Funding amount" is amountRequested on an application but
    // amountAwarded on a report.
    formType: text('form_type').notNull().default('application'),
    // Email of the admin who confirmed the mapping (from the admin app). Nullable
    // for seeded/system mappings.
    addedBy: text('added_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique('field_mappings_client_form_source_uniq').on(t.clientId, t.formType, t.sourceKey)],
)

// An incoming application payload, held while its fields are mapped to canonical
// form. `needs_review` rows wait in the admin queue; `complete`/`ai_proposed` rows
// are promoted to a real `applications` row (linked via `applicationId`). The raw
// payload is always retained for audit and re-mapping.
export const applicationIngests = pgTable(
  'application_ingests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    roundProgrammeId: uuid('round_programme_id')
      .references(() => roundProgrammes.id, { onDelete: 'restrict' }),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
    status: ingestStatusEnum('status').notNull().default('needs_review'),
    // AI proposals for unresolved required fields: canonicalField → { sourceKey, confidence }.
    proposed: jsonb('proposed').$type<Record<string, { sourceKey: string | null; confidence: number }>>(),
    // The final mapping applied: sourceKey → canonicalField.
    resolved: jsonb('resolved').$type<Record<string, string>>(),
    // Set once promoted to a real application.
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
)

// ─── Deprivation reference data ─────────────────────────────────────────────────
//
// One row per small area in the UK: LSOA (England/Wales), Data Zone (Scotland) or
// SOA (Northern Ireland), each carrying its nation's LATEST Index of Multiple
// Deprivation decile. Seeded once from the official files (IoD2025 / WIMD2025 /
// SIMD2020 / NIMDM2017) by scripts/seed-deprivation.ts and refreshed only when a
// nation republishes (every ~5 years) — this is static reference data, ~43k rows.
//
// Lookups: by `code` (a postcode's LSOA → one decile), by `wardCode` (a town → its
// ward's spread) or by `ladCode` (a city → its LAD-wide spread). Codes use the 2021
// statistical geographies, matching what postcodes.io now returns.
export const deprivationAreas = pgTable(
  'deprivation_areas',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    // Best-fit parent ward — null where a nation has no ward mapping in our source.
    wardCode: text('ward_code'),
    ladCode: text('lad_code').notNull(),
    ladName: text('lad_name').notNull(),
    // Statistical region — England only (the 9 regions, e.g. "London"); null elsewhere.
    // Lets a large place like "London" resolve to a region-wide decile range.
    regionName: text('region_name'),
    nation: deprivationNationEnum('nation').notNull(),
    // 1 = most deprived 10% in this nation … 10 = least. Within-nation only.
    decile: integer('decile').notNull(),
    rank: integer('rank'),
    vintage: text('vintage').notNull(), // 'IoD2025' | 'WIMD2025' | 'SIMD2020' | 'NIMDM2017'
  },
  (t) => [
    index('deprivation_areas_ward_idx').on(t.wardCode),
    index('deprivation_areas_lad_idx').on(t.ladCode),
    index('deprivation_areas_region_idx').on(t.regionName),
  ],
)

export const applicationComments = pgTable('application_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Set when a comment is edited in place; null for never-edited comments. Drives
  // the "(edited)" marker in the UI.
  updatedAt: timestamp('updated_at'),
})

export const applicationVotes = pgTable(
  'application_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vote: applicationVoteEnum('vote').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique('application_votes_uniq').on(t.applicationId, t.userId)],
)

// Per-client API keys for the public /api/apply endpoint. A foundation's intake
// integration authenticates with `Authorization: Bearer <key>`; the key resolves to
// the owning client (replacing the old `clientId` body field). Only a SHA-256 hash of
// the key is stored — the plaintext is shown once at creation and never again. `last4`
// is kept purely for display (e.g. cust_sk_••••a1b2). Revoking sets `revokedAt`.
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  last4: text('last4').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
})

// A grant is the live funding relationship created when an award is generated for a
// successful application (after the trustee-majority vote). It is deliberately a
// separate entity from `applications`: the application is the *request* (terminal at
// the decision), the grant is the *outcome* that runs on — paid out via instalments.
//   - `applicationId` is required: every award is generated from an application. The
//     old nullable "direct grant" case (a family office recording money given with no
//     intake) was never built and has been dropped.
//   - `clientId` is denormalised (not derived via the application) because it keeps
//     tenant scoping a single-column filter on the hottest read path. It never
//     changes, so there is no drift risk.
export const awards = pgTable('awards', {
  id: uuid('id').primaryKey().defaultRandom(),
  // `restrict`: an application with an award cannot be deleted out from under it —
  // that would take the instalments and reports with it. Cancel the award first.
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'restrict' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  amountAwarded: numeric('amount_awarded').notNull(),
  status: awardStatusEnum('status').notNull().default('active'),
  // When the award was generated (the grant's start). Mirrors the application's
  // decisionAt for application-derived awards.
  decisionAt: timestamp('decision_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// One scheduled instalment of a grant. Promoted out of the old
// `applications.payment_schedule` jsonb so payments are first-class rows: each can be
// marked paid independently and aggregated across the portfolio (paid-to-date,
// outstanding). `dueDate`/`paidDate` are ISO yyyy-mm-dd strings; `dueDate` is null for
// "date TBC", `paidDate` is null until the instalment is paid.
export const awardInstalments = pgTable('award_instalments', {
  id: uuid('id').primaryKey().defaultRandom(),
  awardId: uuid('award_id')
    .notNull()
    .references(() => awards.id, { onDelete: 'cascade' }),
  instalmentNo: integer('instalment_no').notNull(),
  amount: numeric('amount').notNull(),
  dueDate: text('due_date'),
  paidDate: text('paid_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// One date an award expects a report on. Promoted out of the old
// `applications.reporting_schedule` jsonb so each expectation is a first-class row that
// can be tracked and ticked off independently (mirrors `award_instalments`).
//
// `dueDate` is a required ISO yyyy-mm-dd string — unlike an instalment, an expected
// report always has a date. (It was briefly nullable for "date TBC", but the award
// form never allowed it, so a dateless row could not be created anyway.)
// `submittedDate` is null until a report arrives against it.
export const reportSchedule = pgTable('report_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  awardId: uuid('award_id')
    .notNull()
    .references(() => awards.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  dueDate: text('due_date').notNull(),
  submittedDate: text('submitted_date'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Grant report submissions (report ingest) ───────────────────────────────────

// An incoming grant-report payload from a charity, held while its fields are mapped
// to the report canonical vocabulary and the report is matched to a grant. Mirrors
// `application_ingests`. A row leaves `needs_review` only when BOTH gates pass:
// every required canonical field resolved AND a grant identified (exact
// externalApplicationId match, or an admin pick). The raw payload is always
// retained for audit and re-mapping.
export const reportIngests = pgTable('report_ingests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  status: ingestStatusEnum('status').notNull().default('needs_review'),
  // AI proposals for unresolved required fields: canonicalField → { sourceKey, confidence }.
  proposed: jsonb('proposed').$type<Record<string, { sourceKey: string | null; confidence: number }>>(),
  // The final mapping applied: sourceKey → canonicalField.
  resolved: jsonb('resolved').$type<Record<string, string>>(),
  // Ranked grant suggestions computed by the matching heuristics (charity number,
  // normalised organisation name, programme, amount, award-date fit). Heuristics
  // NEVER auto-link — an admin confirms one of these in the review queue. Kept on
  // the row so a future client-facing match UI can render the same suggestions.
  matchCandidates: jsonb('match_candidates').$type<
    Array<{ awardId: string; score: number; reasons: string[] }>
  >(),
  // Set once promoted to a real report submission.
  reportId: uuid('report_id').references(() => reports.id, {
    onDelete: 'set null',
  }),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: text('resolved_by'),
})

// A charity's submitted grant report, mapped to canonical fields and linked to its
// grant. Created only once mapping + matching both succeed (unresolved reports wait
// in `report_ingests`). Carries the AI analysis: summary, alignment against the
// application's promises and the programme's goal, and the extracted impact
// quantity in the programme's impact unit (which feeds Insights).
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  awardId: uuid('award_id')
    .notNull()
    .references(() => awards.id, { onDelete: 'cascade' }),
  // The reporting milestone this submission satisfied (earliest open one at the
  // time of linking); null when the grant had no open milestones left.
  scheduleId: uuid('schedule_id').references(() => reportSchedule.id, {
    onDelete: 'set null',
  }),
  matchMethod: reportMatchMethodEnum('match_method').notNull(),

  // ── Canonical report fields (see src/lib/fieldMapping/reportCanonical.ts) ──
  externalApplicationId: text('external_application_id'),
  organisationName: text('organisation_name').notNull(),
  charityNumber: text('charity_number'),
  companyNumber: text('company_number'),
  programmeName: text('programme_name'),
  // Amount as stated on the report — kept for cross-checking against the grant's
  // amountAwarded (a mismatch is a wrong-link signal), not a source of truth.
  amountAwarded: numeric('amount_awarded'),
  awardDate: text('award_date'),
  awardEndDate: text('award_end_date'),
  contactName: text('contact_name'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  grantTitle: text('grant_title'),
  grantPurpose: text('grant_purpose'),
  impactSummary: text('impact_summary').notNull(),
  challenges: text('challenges'),
  lessons: text('lessons'),
  caseStudies: text('case_studies'),
  testimonials: text('testimonials'),
  otherComments: text('other_comments'),
  // Directly-asked beneficiary count ("How many young people benefited?"). When the
  // programme measures impact in people, this charity-typed number beats AI extraction.
  beneficiaryCount: integer('beneficiary_count'),
  deliveryArea: text('delivery_area'),
  // Everything from the payload that didn't map to a canonical field. All of it is
  // still fed to the AI analysis. Same shape as applications.responses.
  responses: jsonb('responses').$type<Array<{ label: string; value: string }>>(),

  // ── AI analysis ──
  analysisStatus: reportAnalysisStatusEnum('analysis_status').notNull().default('pending'),
  aiSummary: text('ai_summary'),
  applicationAlignment: jsonb('application_alignment').$type<{
    score: number
    narrative: string
    promisesKept: string[]
    promisesUnmet: string[]
  }>(),
  programmeAlignment: jsonb('programme_alignment').$type<{
    score: number
    narrative: string
  }>(),
  // AI summaries of challenges faced and lessons learned, drawn from anywhere in
  // the report (not just the dedicated fields — foundations' forms scatter these).
  // Null = the report genuinely mentions none.
  aiChallenges: text('ai_challenges'),
  aiLessons: text('ai_lessons'),
  // The resolved impact quantity in the programme's unit; null = no quantity found
  // (surfaced as such — never coerced to zero, so Insights isn't dragged down).
  impactQuantity: numeric('impact_quantity'),
  // 'reported' (charity-typed beneficiaryCount) or 'ai' (extracted from narrative).
  impactQuantitySource: text('impact_quantity_source'),
  // Verbatim supporting quote from the report so a human can verify at a glance.
  impactQuantityQuote: text('impact_quantity_quote'),
  // Programme's impact unit label at analysis time, denormalised so the figure
  // stays interpretable even if the programme's unit is changed later.
  impactUnitLabel: text('impact_unit_label'),
  // Flags and error detail from the analysis run (mirrors custodianScoreDetail).
  analysisDetail: jsonb('analysis_detail').$type<Record<string, unknown>>(),
  analysedAt: timestamp('analysed_at'),

  // Human sign-off: an admin marking the report as reviewed. Null = awaiting
  // review. Drives the 'reviewed' status on the Reports screen.
  reviewedAt: timestamp('reviewed_at'),
  reviewedBy: text('reviewed_by'),

  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Audit log ──────────────────────────────────────────────────────────────

// Human actions taken inside the platform, recorded uniformly for the dashboard
// "Lately" feed and any future history views. Deliberately narrow: only *people*
// doing interesting things (awarding, declining, shortlisting, commenting). It does
// NOT record external submissions (a charity applying/reporting) or system/AI events
// (scoring, due diligence) — those are derivable from their own timestamped rows and
// aren't "someone did something" moments. New action types are added to the enum.
export const auditActionEnum = pgEnum('audit_action', [
  'application_awarded',
  'application_declined',
  'application_shortlisted',
  'application_commented',
])

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Tenant that owns the acted-on entity — the feed is read per client. Resolved
    // from the application (not the actor) so it lands on the right dashboard even
    // when a superadmin acts across tenants.
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // The person who performed the action. `set null` keeps the history when a user
    // is deleted (rendered as an anonymous actor rather than vanishing).
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: auditActionEnum('action').notNull(),
    // The application the action concerns. Every current action is application-scoped;
    // nullable to leave room for future non-application events.
    applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'cascade' }),
    // Small action-specific extras (e.g. `{ amount }` for an award) so the feed can
    // render without extra joins.
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_client_created_idx').on(t.clientId, t.createdAt)],
)

// ─── Relations ────────────────────────────────────────────────────────────────

export const clientsRelations = relations(clients, ({ many, one }) => ({
  users: many(users),
  rounds: many(rounds),
  programmes: many(programmes),
  invitations: many(invitations),
  fieldMappings: many(fieldMappings),
  applicationIngests: many(applicationIngests),
  apiKeys: many(apiKeys),
  awards: many(awards),
  profile: one(clientProfiles, { fields: [clients.id], references: [clientProfiles.clientId] }),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  client: one(clients, { fields: [apiKeys.clientId], references: [clients.id] }),
}))

export const clientProfilesRelations = relations(clientProfiles, ({ one }) => ({
  client: one(clients, { fields: [clientProfiles.clientId], references: [clients.id] }),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  client: one(clients, { fields: [users.clientId], references: [clients.id] }),
  comments: many(applicationComments),
  votes: many(applicationVotes),
}))

export const invitationsRelations = relations(invitations, ({ one }) => ({
  client: one(clients, { fields: [invitations.clientId], references: [clients.id] }),
  invitedByUser: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}))

export const roundsRelations = relations(rounds, ({ one, many }) => ({
  client: one(clients, { fields: [rounds.clientId], references: [clients.id] }),
  roundProgrammes: many(roundProgrammes),
}))

export const programmesRelations = relations(programmes, ({ one, many }) => ({
  client: one(clients, { fields: [programmes.clientId], references: [clients.id] }),
  roundProgrammes: many(roundProgrammes),
}))

export const roundProgrammesRelations = relations(roundProgrammes, ({ one, many }) => ({
  round: one(rounds, { fields: [roundProgrammes.roundId], references: [rounds.id] }),
  programme: one(programmes, { fields: [roundProgrammes.programmeId], references: [programmes.id] }),
  applications: many(applications),
}))

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  roundProgramme: one(roundProgrammes, {
    fields: [applications.roundProgrammeId],
    references: [roundProgrammes.id],
  }),
  comments: many(applicationComments),
  votes: many(applicationVotes),
  // 1:1 in practice (one award per application), modelled as a to-one relation.
  award: one(awards, { fields: [applications.id], references: [awards.applicationId] }),
}))

export const awardsRelations = relations(awards, ({ one, many }) => ({
  application: one(applications, {
    fields: [awards.applicationId],
    references: [applications.id],
  }),
  client: one(clients, { fields: [awards.clientId], references: [clients.id] }),
  instalments: many(awardInstalments),
  // The dates a report is expected on, and the reports actually received.
  schedule: many(reportSchedule),
  reports: many(reports),
}))

export const awardInstalmentsRelations = relations(awardInstalments, ({ one }) => ({
  award: one(awards, { fields: [awardInstalments.awardId], references: [awards.id] }),
}))

export const reportScheduleRelations = relations(reportSchedule, ({ one, many }) => ({
  award: one(awards, { fields: [reportSchedule.awardId], references: [awards.id] }),
  reports: many(reports),
}))

export const reportIngestsRelations = relations(reportIngests, ({ one }) => ({
  client: one(clients, { fields: [reportIngests.clientId], references: [clients.id] }),
  report: one(reports, {
    fields: [reportIngests.reportId],
    references: [reports.id],
  }),
}))

export const reportsRelations = relations(reports, ({ one }) => ({
  client: one(clients, { fields: [reports.clientId], references: [clients.id] }),
  award: one(awards, { fields: [reports.awardId], references: [awards.id] }),
  schedule: one(reportSchedule, {
    fields: [reports.scheduleId],
    references: [reportSchedule.id],
  }),
}))

export const fieldMappingsRelations = relations(fieldMappings, ({ one }) => ({
  client: one(clients, { fields: [fieldMappings.clientId], references: [clients.id] }),
}))

export const applicationIngestsRelations = relations(applicationIngests, ({ one }) => ({
  client: one(clients, { fields: [applicationIngests.clientId], references: [clients.id] }),
  roundProgramme: one(roundProgrammes, {
    fields: [applicationIngests.roundProgrammeId],
    references: [roundProgrammes.id],
  }),
  application: one(applications, {
    fields: [applicationIngests.applicationId],
    references: [applications.id],
  }),
}))

export const applicationCommentsRelations = relations(applicationComments, ({ one }) => ({
  application: one(applications, {
    fields: [applicationComments.applicationId],
    references: [applications.id],
  }),
  user: one(users, { fields: [applicationComments.userId], references: [users.id] }),
}))

export const applicationVotesRelations = relations(applicationVotes, ({ one }) => ({
  application: one(applications, {
    fields: [applicationVotes.applicationId],
    references: [applications.id],
  }),
  user: one(users, { fields: [applicationVotes.userId], references: [users.id] }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  client: one(clients, { fields: [auditLog.clientId], references: [clients.id] }),
  actor: one(users, { fields: [auditLog.actorUserId], references: [users.id] }),
  application: one(applications, {
    fields: [auditLog.applicationId],
    references: [applications.id],
  }),
}))
