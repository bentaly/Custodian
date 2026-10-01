/**
 * Sets one application's budget lines from a JSON file, as an admin would in the app.
 *
 *   pnpm tsx scripts/set-budget-lines.ts <reference|appId> <lines.json> --actor <userId>
 *   pnpm tsx scripts/set-budget-lines.ts <reference|appId> <lines.json> --actor <userId> --apply
 *
 * For a budget that arrived as a FILE the mapper could not read into lines (a costing
 * template laid out in sections, a PDF): somebody reads the file, writes the lines as
 * `[{ "item": "...", "amount": 1234.5, "details": [{ "label": "...", "value": "..." }] }]`,
 * and this puts them on the application.
 *
 * It goes through `setBudgetLines`, the same function the application screen's budget
 * editor calls, rather than writing the column: so the edit lock is honoured (nothing
 * once a trustee has voted or the grant is awarded), the lines are validated, and the
 * change is recorded in `application_edits` and the audit log against `--actor`. Like
 * any edit it does not re-run the assessment; the screen offers "Re-run assessment".
 *
 * Needs DATABASE_URL (`.env` points at staging; prod is the commented-out line).
 */
import { config } from 'dotenv'
config()

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { z } from 'zod'
import { BudgetLineSchema } from '../src/lib/validators/application'
import { setBudgetLines } from '../src/server/applications/edit'

const sql = neon(process.env['DATABASE_URL']!)

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const actorAt = args.indexOf('--actor')
  const actorId = actorAt === -1 ? null : (args[actorAt + 1] ?? null)
  const [target, file] = args.filter((a, i) => !a.startsWith('--') && i !== actorAt + 1)
  if (!target || !file || !actorId) {
    throw new Error(
      'usage: set-budget-lines.ts <reference|appId> <lines.json> --actor <userId> [--apply]',
    )
  }

  const lines = z
    .array(BudgetLineSchema)
    .min(1)
    .max(100)
    .parse(JSON.parse(readFileSync(file, 'utf8')))

  const apps = (await sql`
    select id, organisation_name, status, amount_requested, budget_breakdown
    from applications
    where id::text = ${target} or lower(external_application_id) = lower(${target})
  `) as Array<{
    id: string
    organisation_name: string
    status: string
    amount_requested: string | null
    budget_breakdown: unknown[] | null
  }>
  if (apps.length !== 1) {
    throw new Error(`expected exactly one application for "${target}", got ${apps.length}`)
  }
  const app = apps[0]!

  const actors = (await sql`
    select name, role from users where id = ${actorId} and archived_at is null
  `) as Array<{ name: string; role: string }>
  if (actors.length !== 1) throw new Error(`no live user with id ${actorId}`)

  const total = lines.reduce((sum, l) => sum + l.amount, 0)
  console.log(`${app.organisation_name} [${app.status}], asking £${app.amount_requested ?? '--'}`)
  console.log(`  lines on file now: ${app.budget_breakdown?.length ?? 0}`)
  console.log(`  recorded as edited by: ${actors[0]!.name} (${actors[0]!.role})`)
  for (const l of lines) {
    const details = (l.details ?? []).map((d) => `${d.label}: ${d.value}`).join(', ')
    console.log(`  £${l.amount.toFixed(2).padStart(10)}  ${l.item}${details ? `  (${details})` : ''}`)
  }
  console.log(`  £${total.toFixed(2).padStart(10)}  total of ${lines.length} lines`)

  if (!apply) {
    console.log('\nDry run: nothing written. Re-run with --apply.')
    return
  }

  const result = await setBudgetLines({ applicationId: app.id, lines, actor: { id: actorId } })
  console.log(`\nWritten. ${JSON.stringify(result)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
