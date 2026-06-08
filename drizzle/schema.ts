import {
  pgTable,
  pgEnum,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  uuid,
  numeric,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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

export const programmeStatusEnum = pgEnum('programme_status', ['active', 'draft', 'closed'])

export const roundStatusEnum = pgEnum('round_status', [
  'upcoming',
  'open',
  'reviewing',
  'closed',
])

export const fieldTypeEnum = pgEnum('field_type', [
  'text',
  'textarea',
  'number',
  'select',
  'multi_select',
  'date',
  'file',
  'checkbox',
])

export const applicationStatusEnum = pgEnum('application_status', [
  'submitted',
  'under_review',
  'shortlisted',
  'approved',
  'declined',
  'withdrawn',
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
  budget: numeric('budget'),
  status: roundStatusEnum('status').notNull().default('upcoming'),
  openedAt: timestamp('opened_at'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const programmes = pgTable('programmes', {
  id: uuid('id').primaryKey().defaultRandom(),
  roundId: uuid('round_id')
    .notNull()
    .references(() => rounds.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  goal: text('goal'),
  tags: jsonb('tags').$type<string[]>(),
  status: programmeStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  closedAt: timestamp('closed_at'),
})

export const formFields = pgTable('form_fields', {
  id: uuid('id').primaryKey().defaultRandom(),
  programmeId: uuid('programme_id')
    .notNull()
    .references(() => programmes.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  fieldType: fieldTypeEnum('field_type').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  required: boolean('required').notNull().default(false),
  options: jsonb('options').$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  programmeId: uuid('programme_id')
    .notNull()
    .references(() => programmes.id, { onDelete: 'restrict' }),
  organisationName: text('organisation_name').notNull(),
  organisationRegistrationNumber: text('organisation_registration_number'),
  organisationType: text('organisation_type'),
  bankName: text('bank_name'),
  bankAccountName: text('bank_account_name'),
  bankAccountNumber: text('bank_account_number'),
  bankSortCode: text('bank_sort_code'),
  amountRequested: numeric('amount_requested').notNull(),
  amountAwarded: numeric('amount_awarded'),
  status: applicationStatusEnum('status').notNull().default('submitted'),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dueDiligenceData: jsonb('due_diligence_data').$type<Record<string, any>>(),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  decisionAt: timestamp('decision_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const applicationResponses = pgTable('application_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  applicationId: uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' }),
  fieldId: uuid('field_id')
    .notNull()
    .references(() => formFields.id, { onDelete: 'restrict' }),
  value: text('value').notNull(),
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

// ─── Relations ────────────────────────────────────────────────────────────────

export const clientsRelations = relations(clients, ({ many, one }) => ({
  users: many(users),
  rounds: many(rounds),
  invitations: many(invitations),
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
  programmes: many(programmes),
}))

export const programmesRelations = relations(programmes, ({ one, many }) => ({
  round: one(rounds, {
    fields: [programmes.roundId],
    references: [rounds.id],
  }),
  formFields: many(formFields),
  applications: many(applications),
}))

export const formFieldsRelations = relations(formFields, ({ one, many }) => ({
  programme: one(programmes, { fields: [formFields.programmeId], references: [programmes.id] }),
  responses: many(applicationResponses),
}))

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  programme: one(programmes, { fields: [applications.programmeId], references: [programmes.id] }),
  responses: many(applicationResponses),
}))

export const applicationResponsesRelations = relations(applicationResponses, ({ one }) => ({
  application: one(applications, {
    fields: [applicationResponses.applicationId],
    references: [applications.id],
  }),
  field: one(formFields, {
    fields: [applicationResponses.fieldId],
    references: [formFields.id],
  }),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}))
