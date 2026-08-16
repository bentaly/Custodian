// ─── Demo dataset: shared plumbing ───────────────────────────────────────────
//
// The demo tenant is a whole foundation's worth of representative data — rounds,
// programmes, applications, grants, payments, reports — built so the app can be
// looked at (and demonstrated) as it would be in real use, rather than through the
// accumulated test rows that made every screen misleading.
//
// Everything hangs off ONE client row. That is the property the whole thing rests
// on: `teardown.ts` can remove the dataset exactly, so re-seeding is cheap and the
// data stays disposable instead of silting up the way the last set did.
//
// Dates are stored as OFFSETS from the run date, never as calendar dates. A demo
// with absolute dates is stale within a month — the open round quietly closes and
// the point of it evaporates — so every date in the fixture is resolved at seed time.

import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../src/server/db'
import { clients } from '../../../drizzle/schema'

/** The demo foundation. Fictional, and the only tenant these scripts ever touch. */
export const DEMO_CLIENT_NAME = 'The Wrenfield Foundation'

/**
 * The prod Neon branch. Local `.env` points at staging (see CLAUDE.md), so this is
 * only ever hit by someone who has deliberately swapped the connection string — at
 * which point they get stopped and have to say so out loud. `demo:teardown` deletes
 * a tenant's entire history; it must not be one keystroke from doing that to prod.
 */
const PROD_DB_MARKER = 'ep-cold-bonus'

/** Abort unless the target database is one these scripts may write to. */
export function assertWritableDatabase(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set — check .env')

  const host = url.match(/@([^/?]+)/)?.[1] ?? 'unknown host'
  const isProd = host.includes(PROD_DB_MARKER)

  if (isProd && process.env.DEMO_ALLOW_PROD !== '1') {
    throw new Error(
      `Refusing to run against what looks like the PRODUCTION database (${host}).\n` +
        'If this is deliberate, re-run with DEMO_ALLOW_PROD=1.',
    )
  }
  console.log(`  db: ${host}${isProd ? '  ⚠️  PRODUCTION (DEMO_ALLOW_PROD=1)' : ''}`)
}

/** The demo client row, or null when the dataset has never been seeded. */
export async function findDemoClient() {
  return (
    (await getDb().query.clients.findFirst({ where: eq(clients.name, DEMO_CLIENT_NAME) })) ?? null
  )
}

/** The demo client row, or a clear instruction to seed it first. */
export async function requireDemoClient() {
  const client = await findDemoClient()
  if (!client) {
    throw new Error(`No demo client "${DEMO_CLIENT_NAME}" — run \`pnpm demo:seed\` first.`)
  }
  return client
}

// ─── Dates ───────────────────────────────────────────────────────────────────
//
// One clock for the whole run, so a script that takes several minutes doesn't
// produce rows whose relative dates disagree with each other.

export const NOW = new Date()

export function daysFromNow(days: number): Date {
  const d = new Date(NOW)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export const daysAgo = (days: number): Date => daysFromNow(-days)

export function monthsFromNow(months: number): Date {
  const d = new Date(NOW)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

export const monthsAgo = (months: number): Date => monthsFromNow(-months)

/** `yyyy-mm-dd` — the form instalment and reporting dates are stored in. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ─── Output ──────────────────────────────────────────────────────────────────

export function step(message: string): void {
  console.log(`\n▸ ${message}`)
}

export function done(message: string): void {
  console.log(`  ✓ ${message}`)
}

/** Wrap a script body with the database guard and consistent exit handling. */
export function runScript(name: string, body: () => Promise<void>): void {
  console.log(`\n${name}`)
  Promise.resolve()
    .then(() => {
      assertWritableDatabase()
      return body()
    })
    .then(() => {
      console.log(`\n${name} — done.\n`)
      process.exit(0)
    })
    .catch((err) => {
      console.error(`\n${name} — FAILED\n`)
      console.error(err)
      process.exit(1)
    })
}
