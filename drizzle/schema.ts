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
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { DueDiligenceCheckRecord } from '../src/lib/dueDiligence/types'
import type { CustodianScoreDetail } from '../src/lib/custodianScore/types'

// ─── Enums ────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', [
  'superadmin',
  'admin',
  'manager',
  'contributor',
  'observer',
  'trustee',
])

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

// State of an incoming application payload as it moves through field mapping.
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
])

// ─── Business tables ──────────────────────────────────────────────────────────

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: clientTypeEnum('type').notNull().default('charitable_foundation'),
  description: text('description'),
  website: text('website'),
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
    // How many years grants from this round programme typically run, e.g. 3.
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
  amountAwarded: numeric('amount_awarded'),
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
  invitedBy: text('invited_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
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
    // Email of the admin who confirmed the mapping (from the admin app). Nullable
    // for seeded/system mappings.
    addedBy: text('added_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique('field_mappings_client_source_uniq').on(t.clientId, t.sourceKey)],
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
    externalApplicationId: text('external_application_id'),
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
  (t) => [unique('application_ingests_client_external_uniq').on(t.clientId, t.externalApplicationId)],
)

// ─── Relations ────────────────────────────────────────────────────────────────

export const clientsRelations = relations(clients, ({ many, one }) => ({
  users: many(users),
  rounds: many(rounds),
  programmes: many(programmes),
  invitations: many(invitations),
  fieldMappings: many(fieldMappings),
  applicationIngests: many(applicationIngests),
  profile: one(clientProfiles, { fields: [clients.id], references: [clientProfiles.clientId] }),
}))

export const clientProfilesRelations = relations(clientProfiles, ({ one }) => ({
  client: one(clients, { fields: [clientProfiles.clientId], references: [clients.id] }),
}))

export const usersRelations = relations(users, ({ one }) => ({
  client: one(clients, { fields: [users.clientId], references: [clients.id] }),
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

export const applicationsRelations = relations(applications, ({ one }) => ({
  roundProgramme: one(roundProgrammes, {
    fields: [applications.roundProgrammeId],
    references: [roundProgrammes.id],
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

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))
