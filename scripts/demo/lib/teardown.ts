// ─── Demo dataset: teardown ──────────────────────────────────────────────────
//
// Removes the demo tenant completely. This exists first and runs first (`demo:seed`
// calls it) because a dataset you cannot delete is one nobody dares re-create — which
// is exactly how the app filled up with data that made its own screens misleading.
//
// Deletion is ordered by hand rather than left to `ON DELETE CASCADE` from the client
// row, because two foreign keys are deliberately RESTRICT — `awards.application_id`
// and `applications.round_programme_id` — so that a grant's financial record can never
// be deleted out from under it. A cascade from `clients` walks into those and aborts.
// The order below is the reverse of the dependency graph.
//
// Scope is one client id, everywhere, with no exceptions: this script must be
// incapable of touching another tenant's row.

import { sql } from 'drizzle-orm'
import { getDb } from '../../../src/server/db'
import { done } from './shared'

/** Email domain of the seeded staff logins. RFC 2606 reserves `.example`, so these
 *  addresses can never receive mail even if something tried to send to one. */
export const DEMO_USER_DOMAIN = '@wrenfield.example'

/** Real people who were attached to the demo tenant (you, signing in with Google).
 *  Detached rather than deleted — deleting the row would take the linked Google
 *  account with it and force a re-link on the next sign-in. */
async function detachRealUsers(clientId: string): Promise<number> {
  const res = await getDb().execute(sql`
    update users set client_id = null, role = 'trustee'
    where client_id = ${clientId} and email not like ${'%' + DEMO_USER_DOMAIN}
    returning id
  `)
  return (res.rows ?? []).length
}

export async function teardownDemo(clientId: string): Promise<void> {
  const db = getDb()

  // Every statement is scoped to this client, either directly or through a subselect
  // rooted at it. Listed most-dependent first.
  const statements: Array<[label: string, query: ReturnType<typeof sql>]> = [
    ['reports', sql`delete from reports where client_id = ${clientId} returning id`],
    ['report ingests', sql`delete from report_ingests where client_id = ${clientId} returning id`],
    ['award letters', sql`delete from award_letters where client_id = ${clientId} returning id`],
    [
      'award instalments',
      sql`delete from award_instalments
          where award_id in (select id from awards where client_id = ${clientId}) returning id`,
    ],
    [
      'report schedule',
      sql`delete from report_schedule
          where award_id in (select id from awards where client_id = ${clientId}) returning id`,
    ],
    ['awards', sql`delete from awards where client_id = ${clientId} returning id`],
    ['audit log', sql`delete from audit_log where client_id = ${clientId} returning id`],
    [
      'comments',
      sql`delete from application_comments where application_id in (
            select a.id from applications a
            join round_programmes rp on rp.id = a.round_programme_id
            join rounds r on r.id = rp.round_id
            where r.client_id = ${clientId}
          ) returning id`,
    ],
    [
      'votes',
      sql`delete from application_votes where application_id in (
            select a.id from applications a
            join round_programmes rp on rp.id = a.round_programme_id
            join rounds r on r.id = rp.round_id
            where r.client_id = ${clientId}
          ) returning id`,
    ],
    // Before applications: an ingest points at both the application it promoted to
    // (set null) and the round programme it resolved (RESTRICT).
    [
      'application ingests',
      sql`delete from application_ingests where client_id = ${clientId} returning id`,
    ],
    [
      'applications',
      sql`delete from applications where round_programme_id in (
            select rp.id from round_programmes rp
            join rounds r on r.id = rp.round_id
            where r.client_id = ${clientId}
          ) returning id`,
    ],
    [
      'round programmes',
      sql`delete from round_programmes
          where round_id in (select id from rounds where client_id = ${clientId}) returning id`,
    ],
    ['rounds', sql`delete from rounds where client_id = ${clientId} returning id`],
    ['programmes', sql`delete from programmes where client_id = ${clientId} returning id`],
    ['field mappings', sql`delete from field_mappings where client_id = ${clientId} returning id`],
    ['import batches', sql`delete from import_batches where client_id = ${clientId} returning id`],
    ['api keys', sql`delete from api_keys where client_id = ${clientId} returning id`],
    ['invitations', sql`delete from invitations where client_id = ${clientId} returning id`],
    ['client profile', sql`delete from client_profiles where client_id = ${clientId} returning id`],
    [
      'demo users',
      sql`delete from users
          where client_id = ${clientId} and email like ${'%' + DEMO_USER_DOMAIN} returning id`,
    ],
  ]

  for (const [label, query] of statements) {
    const res = await db.execute(query)
    const n = (res.rows ?? []).length
    if (n > 0) done(`${label}: ${n}`)
  }

  const detached = await detachRealUsers(clientId)
  if (detached > 0) done(`detached real users: ${detached}`)

  await db.execute(sql`delete from clients where id = ${clientId}`)
  done('client')
}
