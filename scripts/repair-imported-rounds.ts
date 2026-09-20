/**
 * Repairs rounds the onboarding data import created before it knew their dates.
 *
 *   pnpm tsx scripts/repair-imported-rounds.ts                 # report, change nothing
 *   pnpm tsx scripts/repair-imported-rounds.ts --apply         # write it
 *   pnpm tsx scripts/repair-imported-rounds.ts --client <uuid> # one tenant
 *
 * Until 2026-09-20 the import stamped `new Date()` on every round it created, so a
 * foundation's whole back catalogue became the most recent round it had ever run, all
 * tied to the millisecond. Applications defaults to the latest round by `opened_at`, so
 * it landed on one of them at random and changed its mind between loads, and the live
 * round looked deleted. The same tie left the round pill, the Rounds screen and
 * Insights' commitment-over-time in no order at all. It also wrote `budget = 0` on the
 * pairings it created, which reads as a budget of nothing rather than none set.
 *
 * The import now derives both. This fixes what it already wrote, and is deliberately
 * narrow: a round is only touched when EVERY application in it came from an import and
 * its stored opening date is later than the last decision made in it, which is the
 * signature of the bug and cannot be true of a round anybody has since corrected by
 * hand. Run it AFTER migration 0094, which is what allows a null budget.
 *
 * Needs DATABASE_URL. Reports what it would do and exits unless --apply is passed.
 */
import { config } from 'dotenv'
config()

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env['DATABASE_URL']!)

type RoundRow = {
  id: string
  name: string
  client_name: string
  opened_at: string
  closed_at: string
  first_decision: string
  last_decision: string
  grants: number
}

/** The day as Postgres reports it. NOT `new Date(d)`: the driver hands timestamps back
 *  as "2022-06-01 00:00:00" with no zone marker, which JS reads as LOCAL time, so under
 *  BST every date in the preview came out a day early while the write (which passes the
 *  string straight back) was correct. A report that disagrees with what it is about to
 *  do is worse than no report. */
const day = (d: string | null) => (d ? String(d).slice(0, 10) : '--')

async function main() {
  const apply = process.argv.includes('--apply')
  const clientAt = process.argv.indexOf('--client')
  const clientId = clientAt === -1 ? null : (process.argv[clientAt + 1] ?? null)

  // Rounds whose every application was imported, dated after their own last decision.
  const rounds = (await sql`
    select r.id, r.name, c.name as client_name, r.opened_at, r.closed_at,
           min(a.decision_at) as first_decision,
           max(a.decision_at) as last_decision,
           count(a.id)::int as grants
    from rounds r
    join clients c on c.id = r.client_id
    join round_programmes rp on rp.round_id = r.id
    join applications a on a.round_programme_id = rp.id
    where (${clientId}::uuid is null or r.client_id = ${clientId}::uuid)
    group by r.id, c.name
    having count(*) filter (where a.import_batch_id is null) = 0
       and max(a.decision_at) is not null
       and r.opened_at > max(a.decision_at)
    order by c.name, max(a.decision_at)`) as RoundRow[]

  console.log(`\n${rounds.length} round(s) to re-date\n`)
  for (const r of rounds) {
    console.log(
      `  ${r.client_name} · ${r.name} (${r.grants} grants)\n` +
        `    ${day(r.opened_at)} → ${day(r.closed_at)}   becomes   ` +
        `${day(r.first_decision)} → ${day(r.last_decision)}`,
    )
  }

  // Pairings in those rounds carrying the £0 stand-in. Scoped to the same rounds, so a
  // £0 a foundation set deliberately on a live round is never touched.
  const ids = rounds.map((r) => r.id)
  const pairs = ids.length
    ? ((await sql`
        select rp.id, r.name as round_name, p.name as programme_name
        from round_programmes rp
        join rounds r on r.id = rp.round_id
        join programmes p on p.id = rp.programme_id
        where rp.round_id = any(${ids}::uuid[]) and rp.budget = 0
        order by r.name, p.name`) as Array<{
        id: string
        round_name: string
        programme_name: string
      }>)
    : []

  console.log(`\n${pairs.length} allocation(s) to clear from £0 to "not set"\n`)
  for (const p of pairs) console.log(`  ${p.round_name} · ${p.programme_name}`)

  // Rounds an import invented that nothing points at any more — a re-upload moved their
  // grants somewhere else. The import now records what it created (`rounds
  // .import_batch_id`) and clears these itself; this finds the ones written before that
  // column existed, by the signature only an import leaves: opened and closed at the
  // same instant, and at a time of day rather than midnight, which is all the round
  // dialog can store. Empty is checked, never assumed. The provenance column is NOT part
  // of the test, so this can be run against a database that predates it — and an
  // import-created round that is empty is one to remove whichever wrote it.
  const orphans = (await sql`
    select r.id, r.name, c.name as client_name, r.opened_at
    from rounds r
    join clients c on c.id = r.client_id
    where (${clientId}::uuid is null or r.client_id = ${clientId}::uuid)
      and r.opened_at = r.closed_at
      and r.opened_at::time <> '00:00:00'
      and not exists (
        select 1 from round_programmes rp
        join applications a on a.round_programme_id = rp.id
        where rp.round_id = r.id
      )
    order by c.name, r.name`) as Array<{
    id: string
    name: string
    client_name: string
    opened_at: string
  }>

  console.log(`\n${orphans.length} empty round(s) left behind by a re-upload, to remove\n`)
  for (const o of orphans) console.log(`  ${o.client_name} · ${o.name}`)

  if (!apply) {
    console.log('\nNothing written. Re-run with --apply.\n')
    return
  }

  for (const r of rounds) {
    await sql`update rounds set opened_at = ${r.first_decision}, closed_at = ${r.last_decision}
              where id = ${r.id}`
  }
  if (pairs.length) {
    await sql`update round_programmes set budget = null
              where id = any(${pairs.map((p) => p.id)}::uuid[])`
  }
  if (orphans.length) {
    const orphanIds = orphans.map((o) => o.id)
    await sql`delete from round_programmes where round_id = any(${orphanIds}::uuid[])`
    await sql`delete from rounds where id = any(${orphanIds}::uuid[])`
  }
  console.log(
    `\nDone: ${rounds.length} round(s) re-dated, ${pairs.length} allocation(s) cleared, ` +
      `${orphans.length} empty round(s) removed.\n`,
  )
}

main().then(() => process.exit(0))
