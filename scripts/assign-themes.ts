/**
 * Gives existing applications their themes (`applications.themes`) WITHOUT re-scoring
 * them. For rows created before themes were picked by the scoring call.
 *
 *   pnpm tsx scripts/assign-themes.ts --client=Arete --dry-run
 *   pnpm tsx scripts/assign-themes.ts --client=Arete --preview --limit=2
 *   pnpm tsx scripts/assign-themes.ts --client=Arete
 *
 * Requires DATABASE_URL + ANTHROPIC_API_KEY. `.env`'s active DATABASE_URL is STAGING;
 * a production run means passing the prod string explicitly for that one command.
 *
 * Why not `rerun-custodian-score.ts`: a re-score rewrites the score, the summary and the
 * grant purpose too, and a board may already have read and voted on those. This asks the
 * model one small question — which of the programme's themes is this about — under the
 * same rules the scoring prompt uses (`THEME_RULES`), and writes nothing else.
 *
 * Only rows with `themes IS NULL` are touched, so a re-run is free and never second-
 * guesses an assignment already made. Two kinds of row need no model at all:
 *
 *   - a programme with no themes → `[]` (nothing to choose from);
 *   - an IMPORTED grant → every theme its programme has, which is exactly what the
 *     import itself now does for a blank Themes cell. Imported rows carry no responses,
 *     so the model would be picking from the organisation's name alone.
 *
 *   --dry-run   lists what each row would get (or "model") and calls nothing. Free.
 *   --preview   calls the model and prints the picks, writing nothing.
 *   (neither)   calls and persists.
 *
 * `--client` is required: there is deliberately no all-tenants variant.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import * as schema from '../drizzle/schema'
import { getAnthropic, SCORING_MODEL } from '../src/server/custodianScore/client'
import { assignedThemes, offeredThemes, THEME_RULES } from '../src/lib/custodianScore'

const db = drizzle(neon(process.env['DATABASE_URL']!), { schema })

const SYSTEM = `You tag grant applications for a UK grant-making foundation with the themes they are about. You will be given a programme's goal and its list of themes, and one application to it.

${THEME_RULES}

Return the themes in the exact structured format requested.`

async function pickThemes(app: Target, themes: string[]): Promise<string[]> {
  const programme = app.roundProgramme.programme
  const responses = (app.responses ?? [])
    .filter((r) => r.value?.trim())
    .map((r) => `### ${r.label}\n${r.value.trim()}`)
    .join('\n\n')
  const prompt = `# Programme: ${programme.name}
Goal: ${programme.goal?.trim() || '(no specific goal recorded)'}${
    programme.description?.trim() ? `\nDescription: ${programme.description.trim()}` : ''
  }
Themes to choose from:
${themes.map((t) => `- ${t}`).join('\n')}

# Application
Organisation: ${app.organisationName}${app.grantPurpose ? `\nWhat the grant would fund: ${app.grantPurpose}` : ''}${
    app.organisationSummary?.trim()
      ? `\n\n## About the organisation (in the applicant's own words)\n${app.organisationSummary.trim()}`
      : ''
  }

## Application responses
${responses || '(no responses provided)'}`

  const message = await getAnthropic().messages.parse({
    model: SCORING_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'low',
      format: zodOutputFormat(
        z.object({ themes: z.array(z.enum(themes as [string, ...string[]])) }),
      ),
    },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })
  if (!message.parsed_output) {
    throw new Error(`no parsed output (stop_reason: ${message.stop_reason})`)
  }
  return assignedThemes(message.parsed_output.themes, themes)
}

async function loadTargets(client: string) {
  const ids = await db
    .select({ id: schema.applications.id })
    .from(schema.applications)
    .innerJoin(
      schema.roundProgrammes,
      eq(schema.roundProgrammes.id, schema.applications.roundProgrammeId),
    )
    .innerJoin(schema.programmes, eq(schema.programmes.id, schema.roundProgrammes.programmeId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.programmes.clientId))
    .where(
      and(
        isNull(schema.applications.themes),
        sql`(lower(trim(${schema.clients.name})) = lower(trim(${client}))
          or ${schema.clients.id}::text = ${client})`,
      ),
    )
  if (ids.length === 0) return []
  return db.query.applications.findMany({
    where: (a, { inArray }) =>
      inArray(
        a.id,
        ids.map((r) => r.id),
      ),
    columns: {
      id: true,
      organisationName: true,
      organisationSummary: true,
      grantPurpose: true,
      responses: true,
      importBatchId: true,
    },
    with: { roundProgramme: { with: { programme: true } } },
    orderBy: (a, { asc }) => [asc(a.submittedAt)],
  })
}
type Target = Awaited<ReturnType<typeof loadTargets>>[number]

async function main() {
  const args = process.argv.slice(2)
  const client = args.find((a) => a.startsWith('--client='))?.split('=')[1]
  const dryRun = args.includes('--dry-run')
  const preview = args.includes('--preview')
  // Caps the rows taken, so `--preview --limit=2` checks the model path for two calls'
  // worth rather than a whole book's.
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || undefined

  if (!client) {
    console.error('--client=<name|id> is required. Add --dry-run to see what would happen.')
    process.exit(1)
  }

  const host = new URL(process.env['DATABASE_URL']!).host
  const targets = (await loadTargets(client)).slice(0, limit)
  console.log(`${host} — ${targets.length} application(s) for "${client}" with no themes.\n`)
  if (targets.length === 0) {
    const all = await db.select({ name: schema.clients.name }).from(schema.clients)
    console.log(`Clients on this database: ${all.map((c) => c.name).join(', ')}`)
    return
  }

  let written = 0
  const failures: string[] = []
  for (const app of targets) {
    const themes = offeredThemes(app.roundProgramme.programme.tags)
    const label = app.organisationName.slice(0, 38).padEnd(40)
    const source =
      themes.length === 0 ? 'no programme themes' : app.importBatchId ? 'imported → all' : 'model'

    if (dryRun) {
      console.log(`  ${label} ${source}${source === 'model' ? ` (from ${themes.join('; ')})` : ''}`)
      continue
    }

    try {
      const picked =
        themes.length === 0 ? [] : app.importBatchId ? themes : await pickThemes(app, themes)
      console.log(`  ${label} ${picked.length ? picked.join('; ') : '—'}  [${source}]`)
      if (!preview) {
        // Guarded on NULL again, so a row tagged by a live score while this ran keeps it.
        await db
          .update(schema.applications)
          .set({ themes: picked })
          .where(and(eq(schema.applications.id, app.id), isNull(schema.applications.themes)))
        written++
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      failures.push(`${app.organisationName}: ${reason}`)
      console.log(`  ${label} FAILED — ${reason}`)
    }
  }

  if (!dryRun) {
    console.log(`\n${preview ? 'Preview — wrote nothing.' : `Wrote ${written}.`}`)
    if (failures.length) {
      console.log(
        `${failures.length} failed (left NULL, safe to re-run):\n  ${failures.join('\n  ')}`,
      )
      process.exitCode = 1
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
