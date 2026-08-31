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
import type { DueDiligenceCheckRecord, OrganisationProfile } from '../src/lib/dueDiligence/types'
import type { CustodianScoreDetail } from '../src/lib/custodianScore/types'
import type { DeprivationResult } from '../src/lib/deprivation/types'
import type { BudgetLine } from '../src/lib/budget/types'

// ─── Enums ────────────────────────────────────────────────────────────────────

// Four roles, deliberately: `superadmin` is platform-level (no client_id), `admin`
// runs a foundation, `trustee` reads/comments/votes, `finance` adds the payment
// actions. The retired `manager`/`contributor`/`observer` values were folded in by
// migration 0049 — manager→admin, contributor/observer→trustee.
export const userRoleEnum = pgEnum('user_role', ['superadmin', 'admin', 'trustee', 'finance'])

export const applicationVoteEnum = pgEnum('application_vote', ['yes', 'no'])

export const clientTypeEnum = pgEnum('client_type', ['charitable_foundation', 'family_office'])

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
export const awardStatusEnum = pgEnum('award_status', ['active', 'completed', 'cancelled'])

// How a key is presented to the sender, and therefore where it may be used. A
// `secret` key is sent in the Authorization header by a caller we control; a
// `webhook` token is EMBEDDED IN A URL, because form platforms (Typeform among them)
// let you set a webhook address and nothing else — no custom headers. The two are
// kept apart rather than sharing one value: a URL is seen by anyone who can edit the
// form, and is written into request logs, so it must be rotatable without taking the
// server-side integration down with it.
export const apiKeyKindEnum = pgEnum('api_key_kind', ['secret', 'webhook'])

// Delivery state of the award letter that notifies a grantee of its grant.
//   draft  — rendered and stored, not yet emailed (no recipient, or send deferred)
//   sent   — handed to Resend without error
//   failed — Resend rejected it, or there was no key/recipient; the stored letter is
//            still viewable and can be resent from the award detail screen
export const awardLetterStatusEnum = pgEnum('award_letter_status', ['draft', 'sent', 'failed'])

// Overall outcome of the automated due diligence screening for an application.
//   pending  — not yet run
//   clear    — all checks passed
//   warning  — one or more soft flags, no hard blocks
//   blocked  — at least one hard block (e.g. charity removed from register)
//   review   — could not screen automatically (API error, or org type with no API); needs manual review
//   no_registration — no charity or company number was supplied, so there is no register to
//                     check: not a pending run, not a flag, and not fixable by re-running
export const dueDiligenceStatusEnum = pgEnum('due_diligence_status', [
  'pending',
  'clear',
  'warning',
  'blocked',
  'review',
  'no_registration',
])

// State of the AI "Custodian score" assessment for an application.
//   pending — no score, and none is coming: scoring is not configured (no
//             ANTHROPIC_API_KEY), or the row predates scoring entirely.
//   queued  — the application exists and a score has been ASKED FOR but has not
//             arrived yet. Distinct from `pending` because the screens say so out
//             loud ("AI is scoring this application"), and a message that cannot
//             tell "waiting" from "never happening" is the lost-field bug again:
//             on `pending` alone, an app with no API key would claim to be scoring
//             forever. The score is 30-60s of model time and no longer runs inside
//             the submission's own invocation, so this state is what the applicant's
//             application wears for its first minute of life.
//   scored  — assessment completed successfully
//   error   — scoring was attempted but failed (API/validation error); re-runnable
export const custodianScoreStatusEnum = pgEnum('custodian_score_status', [
  'pending',
  'queued',
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
  role: userRoleEnum('role').notNull().default('trustee'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // BetterAuth admin plugin — ban controls (unused for now, required by plugin schema)
  banned: boolean('banned').notNull().default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires'),
  // BetterAuth required
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // Opt-in to the Monday payments digest. NULL is not "off" — it is "has never chosen",
  // and it resolves at read time to the role default (`digestDefaultOn` in
  // src/lib/financeDigest/optIn.ts: on for `finance`, off for everyone else). Same
  // convention as `client_profiles.award_letter_template`: a stored value is a decision
  // the user made and always wins; NULL keeps following whatever we think is sensible.
  //
  // A boolean is cheap enough to sit on this row even though `getAuthUser` selects it on
  // every authenticated call — the reason `user_avatars` is a separate table is image
  // bytes, which does not generalise to a flag.
  weeklyFinanceDigest: boolean('weekly_finance_digest'),
  updatedAt: timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
},
  (t) => [
    // Composite rather than `client_id` alone because the hot query is always the
    // pair: `eq(users.role, 'trustee') AND eq(users.clientId, …)` — the vote
    // denominator, read by Shortlist, the dashboard, the vote panel and award set-up.
    // A leading `client_id` still serves `listClientUsers` and the digest on its own.
    index('users_client_role_idx').on(t.clientId, t.role),
  ],
)

// Profile photos live in their own table, deliberately NOT as a column on `users`:
// `getAuthUser` selects the user row on every authenticated server fn, and dragging
// image bytes through that on every call — or inlining them into `getMe`'s payload —
// would be wasteful and uncacheable. `users.image` instead holds the URL of
// `/api/avatar/$userId`, which reads this table and is cached by the browser.
//
// Bytes are stored base64-encoded in a text column rather than as `bytea`: the
// neon-http driver returns binary columns as hex strings, and base64 keeps the
// round-trip explicit at a cost (~33% inflation on a ~15KB image) that does not matter
// at this scale.
//
// R2 was the other candidate and was rejected for now: `pnpm dev` is Vite, not Wrangler,
// so Worker bindings are absent there — an upload would only work under `pnpm preview`.
// Nothing outside `/api/avatar/$userId` knows where the bytes live, so moving to R2
// later is a contained change if these rows ever become a problem.
export const userAvatars = pgTable('user_avatars', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type').notNull(),
  dataBase64: text('data_base64').notNull(),
  // Content hash, used as the `?v=` cache-buster on the avatar URL so a new upload
  // is picked up immediately despite the immutable Cache-Control on the old one.
  hash: text('hash').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  openedAt: timestamp('opened_at'),
  closedAt: timestamp('closed_at'),
  // Retired, not removed. A round that has applications can never be deleted — its
  // applications and awards are financial records that must keep pointing at the round
  // they were judged in — so "I'm done with this" is expressed by archiving: hidden
  // from every picker and list, still rendered wherever its history is shown.
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
},
  (t) => [
    // Every round list is one foundation's: listMyRounds, listRoundsOverview,
    // listRoundDates (on the authenticated layout, so on every page), search.
    index('rounds_client_idx').on(t.clientId),
  ],
)

export const programmes = pgTable('programmes', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  goal: text('goal'),
  tags: jsonb('tags').$type<string[]>(),
  // The colour this programme is recognised by — a lowercase `#rrggbb`, one of the ten
  // presets or a custom pick. Nullable: programmes created before this column keep the
  // positional colour the screen already drew them in (`resolveProgrammeColour`) rather
  // than being backfilled, so no DML migration has to run against live rows.
  colour: text('colour'),
  // Unit this programme measures impact in (key from IMPACT_UNITS, e.g. 'people',
  // 'hectares'). Drives Insights aggregation and the report-analysis extraction
  // prompt ("how many {unit} does this report evidence").
  impactUnit: text('impact_unit').notNull().default('people'),
  // Free-text PLURAL noun phrase when impactUnit = 'other', e.g. "hectares of
  // peatland restored". Used verbatim for display and extraction; never inflected.
  impactUnitLabel: text('impact_unit_label'),
  // See `rounds.archived_at` — same rule: a programme with grants against it stays,
  // because its awards reference it through `round_programmes` for the budget they
  // were judged against.
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
},
  (t) => [
    // `visibleRoundProgrammeIds` (src/server/scope.ts) joins round_programmes to
    // programmes and filters on this column. That runs on EVERY authenticated list
    // query in the app — applications, shortlist, awards, finance, reports, insights,
    // the dashboard, search — so without an index every one of them seq-scans the
    // programmes table. Postgres indexes primary and unique keys automatically but
    // never foreign keys, which is how this went unnoticed.
    index('programmes_client_idx').on(t.clientId),
  ],
)

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
  (t) => [
    unique('round_programmes_uniq').on(t.roundId, t.programmeId),
    // The unique constraint above indexes (round_id, programme_id), which serves
    // round-first lookups. Going the other way — "which rounds is this programme in?",
    // the programme detail screen and the programme filter — needs its own.
    index('round_programmes_programme_idx').on(t.programmeId),
  ],
)

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roundProgrammeId: uuid('round_programme_id')
      .notNull()
      .references(() => roundProgrammes.id, { onDelete: 'restrict' }),
    // The foundation's OWN application reference (distinct from our `id`). Set when
    // an application arrives via the field-mapping ingest path; nullable because
    // applications submitted directly (canonical form) have no external reference.
    externalApplicationId: text('external_application_id'),
    organisationName: text('organisation_name').notNull(),
    // The applicant's contact email address. Required for every new application (a
    // required canonical field), but the column is nullable so it can be added without
    // backfilling existing rows.
    applicantEmail: text('applicant_email'),
    // Registration numbers drive due diligence routing. Both nullable: a CIO has
    // only a charity number, a CIC only a company number, and some entities are
    // dual-registered and have both.
    charityNumber: text('charity_number'),
    companyNumber: text('company_number'),
    bankName: text('bank_name'),
    bankAccountName: text('bank_account_name'),
    bankAccountNumber: text('bank_account_number'),
    bankSortCode: text('bank_sort_code'),
    // What the level-1 modulus check made of the two columns above: valid / invalid /
    // unchecked / missing. A CACHE of a pure function (`lib/bankVerification`'s
    // `bankStatus`), stored only so Finance can sort and count by it without loading
    // every grant to run the algorithm in the Worker. Written by `bankFields()`, which
    // spreads the numbers and this together so no write can update one and not the
    // other. NULL means never computed — a row that predates the column.
    bankCheckStatus: text('bank_check_status'),
    amountRequested: numeric('amount_requested').notNull(),
    // The PROJECT budget as line items, in whole pounds. Nullable — not every
    // foundation collects one, and it is captured only when the incoming form has a
    // structured breakdown (a prose budget narrative stays in `responses`).
    // NB: these lines are NOT a decomposition of `amountRequested` and need not sum
    // to it — the applicant may be asking this funder to fund only part of the
    // budget. Never derive one from the other.
    budgetBreakdown: jsonb('budget_breakdown').$type<BudgetLine[]>(),
    // A link to a budget document the applicant uploaded (a spreadsheet, typically),
    // for foundations whose form asks for the budget as a file rather than as fields.
    // Answers the same question as `budgetBreakdown` by other means — either one
    // satisfies the pair — but is opaque to us: nothing reads the file, so it does not
    // feed the budget UI or the Custodian score the way line items do.
    budgetBreakdownLink: text('budget_breakdown_link'),
    // The impact the applicant PROPOSES to achieve, counted in the programme's own
    // impact unit (people / trees / hectares …). Application-level and forward-looking —
    // distinct from the ACTUAL impact captured later on grant reports (which is what
    // Insights aggregates). Drives the detail-page "Beneficiaries" / "Cost per
    // beneficiary" figures. Nullable — not every foundation collects it.
    proposedImpactQuantity: numeric('proposed_impact_quantity'),
    // Free-text area where the funded PROJECT is delivered — the community served (e.g.
    // "Bradford", "BD1 1AA", "Yorkshire"), NOT where the organisation is based. Captured
    // from the incoming application; nullable as not every foundation collects it. Drives
    // the deprivation context below.
    // NB: the physical column keeps its original name `geography` (a logical-only rename,
    // to avoid a data-losing column rename migration); the app refers to it as deliveryArea.
    deliveryArea: text('geography'),
    responses: jsonb('responses').$type<Array<{ label: string; value: string }>>(),
    // The submission's own running order — one entry per incoming field, in the order
    // the applicant filled it in, naming the canonical field it fed (or null if it
    // stayed a response). An INDEX, not a copy: no value is stored here, so the
    // "View submission" dialog reads every value from the columns above and cannot
    // show a stale figure, or a bank detail the role-based redaction in
    // `getApplication` has already removed. Derived from the ingest's `field_order`
    // and `resolved` at promotion. NULL for applications that never came through the
    // ingest (imports, seeds) and for those promoted before the column existed — the
    // dialog then falls back to its own fixed order.
    submittedFields: jsonb('submitted_fields').$type<
      Array<{ label: string; canonical: string | null }>
    >(),
    status: applicationStatusEnum('status').notNull().default('for_review'),
    // Summary outcome of the automated due diligence screening — cheap to read for
    // the applications list/detail indicator without parsing the checks array.
    dueDiligenceStatus: dueDiligenceStatusEnum('due_diligence_status').notNull().default('pending'),
    // Individual check results. `level` and `label` are intentionally NOT stored —
    // they are UI concerns derived from `key` via the definitions registry in
    // src/lib/dueDiligence. We persist only what was actually checked and its outcome.
    dueDiligenceChecks: jsonb('due_diligence_checks').$type<DueDiligenceCheckRecord[]>(),
    dueDiligenceCheckedAt: timestamp('due_diligence_checked_at'),
    // What the register says the applicant IS, captured on the same calls the checks
    // come from — income, headcounts, and the charity's own description of its work.
    // Written by `runDueDiligence` and read only by the screen: nothing screens on it,
    // which is why it sits beside the checks rather than inside them. Null until the
    // application has been screened against a charity register that answered.
    organisationProfile: jsonb('organisation_profile').$type<OrganisationProfile>(),
    // AI "Custodian score" assessment. `custodianScore` is the denormalised
    // composite (0–100) kept in its own column for cheap list reads and sorting;
    // the per-criterion breakdown, summary, and flags live in `custodianScoreDetail`.
    custodianScoreStatus: custodianScoreStatusEnum('custodian_score_status')
      .notNull()
      .default('pending'),
    custodianScore: integer('custodian_score'),
    custodianScoreDetail: jsonb('custodian_score_detail').$type<CustodianScoreDetail>(),
    custodianScoredAt: timestamp('custodian_scored_at'),
    // One sentence saying what the money would fund, written by the same model call
    // that scores the application. Its own column rather than a field in
    // `custodianScoreDetail` for two reasons: it survives a failed re-score (which
    // replaces the detail blob wholesale), and it is a statement of fact rather than
    // part of the assessment — it makes no judgement and carries no score. Read on the
    // shortlist card and the application screen, and pre-fills the purpose in award
    // set-up, where an admin edits it before it reaches the award letter. The award
    // keeps its OWN copy from that point on: editing the letter's wording must not
    // rewrite what the AI made of the application.
    grantPurpose: text('grant_purpose'),
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
    // Set when this row came from the onboarding data import rather than a real
    // submission. Load-bearing beyond provenance: an imported application has no
    // responses, no score, no due diligence trail and no votes, and those blanks read as
    // LOST DATA unless the row can say it predates Custodian. It is also why imported
    // grants sit out of measures like "promises kept" rather than counting as zero —
    // a grant that never had a report is not a grant that failed.
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
    submittedAt: timestamp('submitted_at').notNull().defaultNow(),
    decisionAt: timestamp('decision_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  // Postgres indexes primary keys and unique constraints on its own but NEVER foreign
  // keys, so without these every list query is a sequential scan of the whole table —
  // invisible at a few hundred rows, linear thereafter.
  (t) => [
    // `round_programme_id` is the tenancy filter on every list query; adding `status`
    // serves the status filter and tab counts from the same index. A query on
    // `round_programme_id` alone still uses it — a composite index works on any
    // leading subset of its columns.
    index('applications_scope_status_idx').on(t.roundProgrammeId, t.status),
    // The applications list filters by scope and orders by newest first; with the sort
    // column in the index, Postgres reads a page in order instead of sorting the lot.
    index('applications_scope_submitted_idx').on(t.roundProgrammeId, t.submittedAt),
    // The foundation's own reference, looked up on every report ingest to auto-link a
    // submission to its grant.
    index('applications_external_id_idx').on(t.externalApplicationId),
  ],
)

// ─── BetterAuth tables ────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // BetterAuth admin plugin — set to the admin's user id while impersonating
  impersonatedBy: text('impersonated_by'),
})

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
  role: userRoleEnum('role').notNull().default('trustee'),
  token: text('token').notNull().unique(),
  // Nullable: invites created from the (token-gated) admin app have no main-app
  // user to attribute. In-app invites still set this to the inviting user.
  invitedBy: text('invited_by').references(() => users.id, { onDelete: 'cascade' }),
  // Cloudflare Access email of the admin-app operator, when invitedBy is null.
  invitedByEmail: text('invited_by_email'),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
},
  (t) => [
    // `listInvitations` (Settings → Team) filters client_id and pending-only.
    index('invitations_client_idx').on(t.clientId),
  ],
)

export const clientProfiles = pgTable('client_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: 'cascade' }),
  missionStatement: text('mission_statement'),
  // When true, admins may record votes on behalf of trustees (see castVote).
  allowAdminVoting: boolean('allow_admin_voting').notNull().default(false),
  // ─── Award letter ───
  // The foundation's override of the built-in award-letter template (markdown with
  // {{token}} placeholders — see src/lib/awardLetter). NULL means "use the built-in
  // default", which is deliberately different from an empty string: we want a
  // foundation that has never touched this to keep picking up template improvements,
  // and clearing the editor back to the default writes NULL rather than ''.
  awardLetterTemplate: text('award_letter_template'),
  // The standard conditions of grant, in order. NULL = use the built-in list; an
  // empty array is a real choice (a foundation that attaches no standard conditions).
  awardLetterConditions: jsonb('award_letter_conditions').$type<string[]>(),
  // Who the letter is signed off by, e.g. "Jane Fairfax, Chair of Trustees".
  awardLetterSignatory: text('award_letter_signatory'),
  // Display name on the From header. Defaults to the client's name when unset.
  awardLetterSenderName: text('award_letter_sender_name'),
  // Where the grantee's reply goes. This is the load-bearing half of "make it look
  // like it came from the foundation": we cannot put their address in From without
  // a DNS-verified sending domain, but Reply-To needs no proof of ownership, so a
  // grantee hitting reply lands in the foundation's inbox, not ours.
  awardLetterReplyTo: text('award_letter_reply_to'),
  // ─── Financial year ───
  // The MONTH the foundation's financial year ends in (1–12), which is how a
  // grant-maker states it — "our year end is 31 March" is on the front of their signed
  // accounts. See `src/lib/financialYear.ts` for why the end and not the start, and why
  // a month and not a full date. NOT NULL with the commonest UK charity year end as the
  // default, so a foundation that never opens the setting still gets a year that
  // matches its accounts rather than a calendar year nobody chose.
  financialYearEndMonth: integer('financial_year_end_month').notNull().default(3),
  // Does Finance offer the "Balance & budget" screen at all?
  //
  // A VISIBILITY preference, not a claim about what exists — which is why it is a column
  // and the data is left alone. Not every foundation works this way (a family office may
  // draw grant money from the principal's balance sheet; an endowed foundation's real
  // number is a portfolio held elsewhere), and the first cut made "off" mean "delete your
  // budget", which is not a switch, it is a demolition. Turning this off hides the tab and
  // collapses the settings page to the switch; every figure is still there when it goes
  // back on.
  //
  // Default TRUE: the tab is one word, and it is the only route to a foundation's first
  // bank-balance reading, so hiding it by default would hide the way in.
  showBalanceAndBudget: boolean('show_balance_and_budget').notNull().default(true),
  updatedAt: timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
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
export const applicationIngests = pgTable('application_ingests', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  roundProgrammeId: uuid('round_programme_id').references(() => roundProgrammes.id, {
    onDelete: 'restrict',
  }),
  rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
  // The order the sender's fields arrived in, captured because `raw_payload` cannot
  // hold it: Postgres normalises jsonb object keys (by length, then bytewise), so the
  // very write that preserves the submission destroys the order it was made in. A
  // 38-question form comes back out as "Trustees, Full-time, Part-time, Volunteers,
  // Budget total…" — an order no applicant ever saw. Written by `saveIngest` from the
  // decoded body, where the wire order still exists, and it is the only place it does.
  // NULL on rows that predate the column; their order is not recoverable.
  fieldOrder: jsonb('field_order').$type<string[]>(),
  status: ingestStatusEnum('status').notNull().default('needs_review'),
  // AI proposals for unresolved required fields: canonicalField → { sourceKey, confidence }.
  proposed:
    jsonb('proposed').$type<Record<string, { sourceKey: string | null; confidence: number }>>(),
  // The final mapping applied: sourceKey → canonicalField.
  resolved: jsonb('resolved').$type<Record<string, string>>(),
  // Canonical fields a reviewer TYPED rather than pointed at an incoming field:
  // canonicalField → value. Kept separately from `resolved` because that map is keyed
  // on the source key and a typed value has none. Stored rather than merely applied so
  // a re-confirm doesn't blank it: `updateApplicationFromCanonical` writes the whole
  // canonical set, so a value the reviewer supplied and the ingest forgot would be
  // NULLed the next time anyone pressed Confirm.
  providedValues: jsonb('provided_values').$type<Record<string, string>>(),
  // Set once promoted to a real application.
  applicationId: uuid('application_id').references(() => applications.id, { onDelete: 'set null' }),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: text('resolved_by'),
},
  (t) => [
    // What `/api/admin/ingests` actually does: filter by status, order by createdAt
    // desc. NOT client_id, which nothing filters on here — the admin app is
    // cross-tenant by design. Polled twice a minute for as long as a queue tab is
    // open, which is what makes it worth an index on a table this small.
    index('application_ingests_status_created_idx').on(t.status, t.createdAt),
  ],
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

export const applicationComments = pgTable(
  'application_comments',
  {
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
  },
  // The discussion thread on an application detail page.
  (t) => [index('application_comments_application_idx').on(t.applicationId)],
)

export const applicationVotes = pgTable(
  'application_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    // Whose vote this is. Always the trustee — see `recordedByUserId`.
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    vote: applicationVoteEnum('vote').notNull(),
    // Who actually entered it, when that is not the trustee themselves. NULL means the
    // trustee voted for themselves, which is the ordinary case and why the column is
    // nullable with no backfill — every row predating it was cast by its own user.
    //
    // Without this the two are indistinguishable: where a client has enabled admin
    // voting, an administrator recording a vote produces a row identical to the
    // trustee having cast it, and a trustee majority is what unlocks awarding a grant.
    // `set null` on delete keeps the vote and loses only the proxy's name, matching how
    // `audit_log` treats a departed actor.
    recordedByUserId: text('recorded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
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
  // Every key predating webhooks is a header key, which is what the default says.
  kind: apiKeyKindEnum('kind').notNull().default('secret'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  createdBy: text('created_by'),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
},
  (t) => [
    // `listApiKeys` on Settings → API keys. Small table, but `resolveToken` also
    // WRITES `lastUsedAt` on every public submission, so keeping the read cheap
    // matters more than the index costs.
    index('api_keys_client_idx').on(t.clientId),
  ],
)

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
export const awards = pgTable(
  'awards',
  {
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
    // What the money is FOR, in the foundation's words — "towards {{purpose}}" on the
    // award letter, and the thing a later grant report is judged against. Captured
    // during award set-up. Nullable: awards minted before this column existed have none.
    purpose: text('purpose'),
    // A condition that applies to this grant alone (e.g. "restricted to capital
    // works"), appended after the standard conditions on the letter.
    specialCondition: text('special_condition'),
    // The date the grant period begins, as an ISO yyyy-mm-dd string. Distinct from
    // `decisionAt` (when the award was made) and from the first instalment date (money
    // may move before or after the period opens). Nullable — it is a letter/reporting
    // concern, not something every legacy award has.
    startDate: text('start_date'),
    // When the award was generated (the grant's start). Mirrors the application's
    // decisionAt for application-derived awards.
    decisionAt: timestamp('decision_at').notNull().defaultNow(),
    // Set when this grant was brought in by the onboarding import — see the matching
    // column on `applications`. An imported award is deliberately NOT created through
    // `createAwards`: that path enforces a trustee majority, which is right for a
    // decision being made and meaningless for a fact being recorded.
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    // One grant per application — the `award: one(...)` relation and every money
    // rollup assume it; a double-submitted award set-up must hit this wall.
    unique('awards_application_uniq').on(t.applicationId),
    // Insights and Reports read a whole foundation's grants, newest decisions first.
    index('awards_client_decision_idx').on(t.clientId, t.decisionAt),
  ],
)

// One scheduled instalment of a grant. Promoted out of the old
// `applications.payment_schedule` jsonb so payments are first-class rows: each can be
// marked paid independently and aggregated across the portfolio (paid-to-date,
// outstanding). `dueDate`/`paidDate` are ISO yyyy-mm-dd strings; `dueDate` is null for
// "date TBC", `paidDate` is null until the instalment is paid.
export const awardInstalments = pgTable(
  'award_instalments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    awardId: uuid('award_id')
      .notNull()
      .references(() => awards.id, { onDelete: 'cascade' }),
    instalmentNo: integer('instalment_no').notNull(),
    amount: numeric('amount').notNull(),
    dueDate: text('due_date'),
    paidDate: text('paid_date'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  // Every payment rollup — Finance, Awards, the dashboard — groups instalments by award.
  (t) => [index('award_instalments_award_idx').on(t.awardId)],
)

// One date an award expects a report on. Promoted out of the old
// `applications.reporting_schedule` jsonb so each expectation is a first-class row that
// can be tracked and ticked off independently (mirrors `award_instalments`).
//
// `dueDate` is a required ISO yyyy-mm-dd string — unlike an instalment, an expected
// report always has a date. (It was briefly nullable for "date TBC", but the award
// form never allowed it, so a dateless row could not be created anyway.)
// `submittedDate` is null until a report arrives against it.
export const reportSchedule = pgTable(
  'report_schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    awardId: uuid('award_id')
      .notNull()
      .references(() => awards.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    dueDate: text('due_date').notNull(),
    submittedDate: text('submitted_date'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  // The Reports screen walks every award's milestones to work out what is outstanding.
  (t) => [index('report_schedule_award_idx').on(t.awardId)],
)

// The award letter issued to a grantee — the document that tells a charity it has the
// money and on what terms.
//
// This is a SNAPSHOT, not a view. The letter is rendered once at award set-up from the
// ─── Annual budget and bank balance ──────────────────────────────────────────
//
// Two features that are read together and written apart.
//
// The Finance screen answers one question with both: "can we cover what we have
// promised?" — which needs the cash position AND the year's plan. But they are
// different KINDS of fact, on different clocks, so they are stored and edited
// separately: a budget is a decision the trustees make once a year, and a balance is an
// observation somebody makes off a bank statement. Neither is required, and each works
// without the other — see `src/server/finance/budget.ts` for what the panel draws when
// only one is present.

// A foundation's grant-making budget for one financial year.
//
// Deliberately per-year rows rather than a mutable figure on `client_profiles`: last
// year's budget is the comparative that next year's is judged against, and a foundation
// that overwrites it every April has thrown away the only number that made this year's
// mean anything. The financial year is stored as resolved dates rather than recomputed
// from `client_profiles.financial_year_end_month`, so changing the year end later does
// not silently re-label budgets that were set under the old one.
export const annualBudgets = pgTable(
  'annual_budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Inclusive `yyyy-mm-dd` bounds of the financial year this budget is for. */
    financialYearStart: text('financial_year_start').notNull(),
    financialYearEnd: text('financial_year_end').notNull(),
    /** "2026/27", or "2026" for a foundation on a calendar year. Rendered as stored. */
    label: text('label').notNull(),
    updatedByUserId: text('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at')
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    // One budget per foundation per year. Saving is an upsert onto this.
    unique('annual_budgets_client_year_uniq').on(t.clientId, t.financialYearStart),
  ],
)

// One allocation within an annual budget: a programme, or a non-grant line.
//
// **`programmeId` NULL is core costs** — the running of the foundation, which is real
// money out of the same budget and is not a fundable programme. It was tempting to make
// core costs a `programmes` row so the meters need no special case, but every consumer
// of that table is grant-shaped (round_programmes, applications, awards, impact units,
// programme colours, the shortlist), and a programme that can never receive an
// application would be a permanent exception in all of them. A nullable FK with its own
// `label` keeps it out, and generalises for free: a foundation wanting separate staff,
// premises and governance lines gets them without a migration.
//
// Amounts are stated, not derived from `round_programmes.budget`. A foundation can
// budget £366,000 to a programme for the year and put only £300,000 of it into rounds,
// holding the rest back for unsolicited grants — deriving would make that
// unrepresentable, and the reconciliation between the two figures is the point of the
// screen rather than a discrepancy to be designed away.
export const annualBudgetLines = pgTable(
  'annual_budget_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => annualBudgets.id, { onDelete: 'cascade' }),
    /** NULL = a non-grant line (core costs), named by `label`. */
    programmeId: uuid('programme_id').references(() => programmes.id, { onDelete: 'cascade' }),
    /** Only read for non-grant lines; a programme line is named by the programme. */
    label: text('label'),
    amount: numeric('amount').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('annual_budget_lines_budget_idx').on(t.budgetId),
    // A programme cannot appear twice in one year's budget. Postgres treats NULLs as
    // distinct in a unique index, which is exactly right here: several core-cost lines
    // are allowed, several "Youth Futures" lines are not.
    unique('annual_budget_lines_programme_uniq').on(t.budgetId, t.programmeId),
  ],
)

// A reading of the foundation's grant-making bank balance, as somebody recorded it.
//
// An append-only LEDGER, not a mutable column, for three reasons: the figure on screen
// is one a board may act on, so who said it and when is part of the number; a balance
// with no history cannot be charted or sanity-checked; and when an open-banking feed
// eventually arrives it becomes another writer of these rows rather than a migration.
//
// `asAtDate` is the date the balance was TRUE, which is not `createdAt` — somebody
// entering Monday's closing balance on Thursday must be able to say so, or the
// staleness warning on the Finance panel lies in both directions.
export const bankBalanceReadings = pgTable(
  'bank_balance_readings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    amount: numeric('amount').notNull(),
    /** `yyyy-mm-dd` — the date this balance was true, not the date it was typed. */
    asAtDate: text('as_at_date').notNull(),
    note: text('note'),
    recordedByUserId: text('recorded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    // The panel wants the latest reading for one foundation, which is this index read
    // backwards. `createdAt` breaks the tie when two readings share an as-at date: the
    // later correction wins, which is what a correction is for.
    index('bank_balance_readings_client_date_idx').on(t.clientId, t.asAtDate, t.createdAt),
  ],
)

// then-current template, conditions, amounts and schedule, and the rendered text is
// stored here verbatim. That is the whole point: the letter is a contractual record of
// what was promised, so editing the template in Settings next month, or rescheduling an
// instalment, must not retroactively rewrite what a grantee was actually sent. Nothing
// re-renders a stored letter; "resend" posts the same bytes again.
export const awardLetters = pgTable('award_letters', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Unique: one letter record per award. A resend updates this row (sentAt, status)
  // rather than accumulating rows — the delivery attempts are not the document.
  awardId: uuid('award_id')
    .notNull()
    .unique()
    .references(() => awards.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id')
    .notNull()
    .references(() => clients.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  // The letter body as rendered markdown-ish plain text (the source of truth), and the
  // HTML actually emailed. Both are stored so the award detail screen can show exactly
  // what was sent without re-running the renderer.
  bodyText: text('body_text').notNull(),
  bodyHtml: text('body_html').notNull(),
  // The conditions of grant as they stood when the letter was issued, in order.
  conditions: jsonb('conditions').$type<string[]>().notNull(),
  status: awardLetterStatusEnum('status').notNull().default('draft'),
  // Who it went to, and where a reply lands. Snapshotted for the same reason as the
  // body — the client's reply-to setting may change later.
  recipientEmail: text('recipient_email'),
  replyTo: text('reply_to'),
  senderName: text('sender_name'),
  // Why a send failed, surfaced on the award detail screen so a stuck letter is
  // visible and actionable rather than silently undelivered.
  failureReason: text('failure_reason'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .$defaultFn(() => new Date()),
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
  proposed:
    jsonb('proposed').$type<Record<string, { sourceKey: string | null; confidence: number }>>(),
  // The final mapping applied: sourceKey → canonicalField.
  resolved: jsonb('resolved').$type<Record<string, string>>(),
  // Ranked grant suggestions computed by the matching heuristics (charity number,
  // normalised organisation name, programme, amount, award-date fit). Heuristics
  // NEVER auto-link — an admin confirms one of these in the review queue. Kept on
  // the row so a future client-facing match UI can render the same suggestions.
  matchCandidates:
    jsonb('match_candidates').$type<Array<{ awardId: string; score: number; reasons: string[] }>>(),
  // Set once promoted to a real report submission.
  reportId: uuid('report_id').references(() => reports.id, {
    onDelete: 'set null',
  }),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
  resolvedBy: text('resolved_by'),
},
  (t) => [
    // Same query, same reason as `application_ingests` — kept in step with it.
    index('report_ingests_status_created_idx').on(t.status, t.createdAt),
  ],
)

// A charity's submitted grant report, mapped to canonical fields and linked to its
// grant. Created only once mapping + matching both succeed (unresolved reports wait
// in `report_ingests`). Carries the AI analysis: summary, alignment against the
// application's promises and the programme's goal, and the extracted impact
// quantity in the programme's impact unit (which feeds Insights).
export const reports = pgTable(
  'reports',
  {
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

    // Set when this row was created by the onboarding import to carry a historic impact
    // figure the foundation already held. Such a row has `matchMethod = 'import'`, an
    // `impactQuantity` and no AI analysis — there is no narrative to analyse, just a
    // number someone typed. Recording it as a report rather than as a column on the award
    // means Insights, which already reads impact from reports, needs no special case for
    // imported history.
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
    submittedAt: timestamp('submitted_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  // Reports are always read through their grant — the Reports list, the award detail,
  // and the Insights impact rollup all start from an award.
  (t) => [
    index('reports_award_idx').on(t.awardId),
    // `reportsList` scopes the whole Reports screen on this column directly, rather
    // than reaching it through the award — see the note on `clientId` being
    // denormalised precisely to keep that a single-column filter.
    index('reports_client_idx').on(t.clientId),
  ],
)

// ─── Historical data import ─────────────────────────────────────────────────

// Whether an import's rows are still live, or have been withdrawn again.
//   committed   — the rows it created are in use
//   rolled_back — the rows were removed; the batch is kept as a record that it happened
export const importBatchStatusEnum = pgEnum('import_batch_status', ['committed', 'rolled_back'])

// One run of the onboarding data import: a foundation's existing portfolio, brought in
// from a spreadsheet so the app is accurate on the day they start rather than pretending
// their history began then.
//
// The batch exists to make the import REVERSIBLE. Every row the run creates carries this
// id, so the whole thing can be withdrawn in one go while nothing has been acted on. That
// is not a nicety: an import that cannot be undone gets treated as irreversible and
// terrifying, so people do a five-row test and stall for a month rather than committing
// their real portfolio. Being able to say "you can undo this" is what makes the first
// attempt cheap.
//
// The reconciliation figures are stored as they were CONFIRMED, not recomputed — they are
// the record of what a finance lead signed off against their own ledger, and must not
// drift as instalments are later marked paid.
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    status: importBatchStatusEnum('status').notNull().default('committed'),
    // Original filename, so a client can tell two runs apart at a glance.
    fileName: text('file_name'),
    grantCount: integer('grant_count').notNull().default(0),
    paymentCount: integer('payment_count').notNull().default(0),
    reportCount: integer('report_count').notNull().default(0),
    totalCommitted: numeric('total_committed').notNull().default('0'),
    totalPaid: numeric('total_paid').notNull().default('0'),
    totalOutstanding: numeric('total_outstanding').notNull().default('0'),
    // The degradations the client accepted at the review step, kept so "we were never
    // told this would be missing" can be answered.
    acceptedWarnings: jsonb('accepted_warnings').$type<string[]>(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    // Denormalised so the history still names someone after the user is deleted.
    createdByName: text('created_by_name'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    rolledBackAt: timestamp('rolled_back_at'),
    rolledBackBy: text('rolled_back_by'),
  },
  (t) => [index('import_batches_client_created_idx').on(t.clientId, t.createdAt)],
)

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
  'application_registration_set',
  'grant_bank_details_changed',
  'grant_payment_recorded',
  'grant_payment_reversed',
  'grant_payment_amended',
  'application_comment_deleted',
  'application_vote_recorded_by_admin',
  'grant_report_milestone_added',
  'grant_report_milestone_changed',
  'grant_report_milestone_removed',
  'grant_report_reviewed',
  'award_letter_resent',
  'api_key_created',
  'api_key_revoked',
  'invitation_sent',
  'annual_budget_set',
  'bank_balance_recorded',
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
    applicationId: uuid('application_id').references(() => applications.id, {
      onDelete: 'cascade',
    }),
    // Small action-specific extras (e.g. `{ amount }` for an award) so the feed can
    // render without extra joins.
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_client_created_idx').on(t.clientId, t.createdAt)],
)

// ─── Scheduled email ────────────────────────────────────────────────────────

/**
 * A receipt: this user was sent the payments digest for this week.
 *
 * It is a RECEIPT, written after Resend accepts the message — not a claim written
 * before. That choice is the whole failure model. Cron Triggers are at-least-once and
 * a run can be cut short (a 10ms CPU ceiling on the Workers Free plan makes that a
 * real possibility, not a theoretical one), so the question is what a re-run does:
 *
 *   receipt-after  — a re-run finishes the users who never got one, skips those who
 *                    did. Worst case, a send that succeeded while the insert failed
 *                    sends one duplicate.
 *   claim-before   — a run killed mid-flight leaves rows saying "sent" for people who
 *                    got nothing, and no re-run will ever correct it.
 *
 * A duplicate digest is an annoyance; a missing one means a payment is missed, which is
 * the entire thing this email exists to prevent. So: receipt-after.
 *
 * The unique key is what makes the digest safe to trigger by hand and safe to re-run:
 * Cron Triggers are at-least-once, a partial run wants finishing, and during the dry-run
 * period the endpoint is being curled by a person. All three arrive at the same table
 * and the second one through does nothing.
 */
export const financeDigestSends = pgTable(
  'finance_digest_sends',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // The Monday of the week the digest covered, `yyyy-mm-dd`. A calendar date, so
    // `text` like every other date the schedule reads (see src/lib/schedule.ts).
    weekOf: text('week_of').notNull(),
    // What was in it. Stored so "why didn't I get one this week?" has an answer that is
    // not "read the logs" — a week with nothing due sends nothing and writes no row, and
    // these two columns are how a week that DID send is told apart from one that had
    // nothing to say.
    itemCount: integer('item_count').notNull(),
    totalAmount: numeric('total_amount').notNull(),
    sentAt: timestamp('sent_at').notNull().defaultNow(),
  },
  (t) => [
    // The dedupe. `onConflictDoNothing` against this is what makes a second run a no-op
    // rather than a second email.
    unique('finance_digest_sends_user_week_uniq').on(t.userId, t.weekOf),
  ],
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

export const annualBudgetsRelations = relations(annualBudgets, ({ one, many }) => ({
  client: one(clients, { fields: [annualBudgets.clientId], references: [clients.id] }),
  updatedByUser: one(users, {
    fields: [annualBudgets.updatedByUserId],
    references: [users.id],
  }),
  lines: many(annualBudgetLines),
}))

export const annualBudgetLinesRelations = relations(annualBudgetLines, ({ one }) => ({
  budget: one(annualBudgets, {
    fields: [annualBudgetLines.budgetId],
    references: [annualBudgets.id],
  }),
  programme: one(programmes, {
    fields: [annualBudgetLines.programmeId],
    references: [programmes.id],
  }),
}))

export const bankBalanceReadingsRelations = relations(bankBalanceReadings, ({ one }) => ({
  client: one(clients, { fields: [bankBalanceReadings.clientId], references: [clients.id] }),
  recordedByUser: one(users, {
    fields: [bankBalanceReadings.recordedByUserId],
    references: [users.id],
  }),
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
  programme: one(programmes, {
    fields: [roundProgrammes.programmeId],
    references: [programmes.id],
  }),
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
  // 1:1 (unique awardId), modelled as a to-one relation like `applications.award`.
  letter: one(awardLetters, { fields: [awards.id], references: [awardLetters.awardId] }),
}))

export const awardLettersRelations = relations(awardLetters, ({ one }) => ({
  award: one(awards, { fields: [awardLetters.awardId], references: [awards.id] }),
  client: one(clients, { fields: [awardLetters.clientId], references: [clients.id] }),
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

export const importBatchesRelations = relations(importBatches, ({ one, many }) => ({
  client: one(clients, { fields: [importBatches.clientId], references: [clients.id] }),
  createdByUser: one(users, { fields: [importBatches.createdBy], references: [users.id] }),
  applications: many(applications),
  awards: many(awards),
}))

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  client: one(clients, { fields: [auditLog.clientId], references: [clients.id] }),
  actor: one(users, { fields: [auditLog.actorUserId], references: [users.id] }),
  application: one(applications, {
    fields: [auditLog.applicationId],
    references: [applications.id],
  }),
}))
