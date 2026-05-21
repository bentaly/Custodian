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

export const foundations = pgTable('foundations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description'),
  website: text('website'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// BetterAuth required fields (email_verified, image, updated_at) are included
// alongside the business fields from the data model. Auth plumbing only.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  foundationId: uuid('foundation_id').references(() => foundations.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  role: userRoleEnum('role').notNull().default('observer'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // BetterAuth required
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

export const programmes = pgTable('programmes', {
  id: uuid('id').primaryKey().defaultRandom(),
  foundationId: uuid('foundation_id')
    .notNull()
    .references(() => foundations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  status: programmeStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  closedAt: timestamp('closed_at'),
})

export const rounds = pgTable('rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  programmeId: uuid('programme_id')
    .notNull()
    .references(() => programmes.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  budget: numeric('budget'),
  status: roundStatusEnum('status').notNull().default('upcoming'),
  openedAt: timestamp('opened_at'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
  roundId: uuid('round_id')
    .notNull()
    .references(() => rounds.id, { onDelete: 'restrict' }),
  organisationName: text('organisation_name').notNull(),
  charityNumber: text('charity_number'),
  contactName: text('contact_name').notNull(),
  contactEmail: text('contact_email').notNull(),
  amountRequested: numeric('amount_requested').notNull(),
  amountAwarded: numeric('amount_awarded'),
  status: applicationStatusEnum('status').notNull().default('submitted'),
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

// ─── Relations ────────────────────────────────────────────────────────────────

export const foundationsRelations = relations(foundations, ({ many }) => ({
  users: many(users),
  programmes: many(programmes),
}))

export const usersRelations = relations(users, ({ one }) => ({
  foundation: one(foundations, { fields: [users.foundationId], references: [foundations.id] }),
}))

export const programmesRelations = relations(programmes, ({ one, many }) => ({
  foundation: one(foundations, {
    fields: [programmes.foundationId],
    references: [foundations.id],
  }),
  rounds: many(rounds),
  formFields: many(formFields),
}))

export const roundsRelations = relations(rounds, ({ one, many }) => ({
  programme: one(programmes, { fields: [rounds.programmeId], references: [programmes.id] }),
  applications: many(applications),
}))

export const formFieldsRelations = relations(formFields, ({ one, many }) => ({
  programme: one(programmes, { fields: [formFields.programmeId], references: [programmes.id] }),
  responses: many(applicationResponses),
}))

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  round: one(rounds, { fields: [applications.roundId], references: [rounds.id] }),
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
