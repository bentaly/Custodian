/**
 * One-off: give The Arete Foundation's thirteen live submissions the two canonical
 * fields that did not exist when they were promoted — `organisationSummary` and
 * `unrestrictedReserves`.
 *
 *   pnpm tsx scripts/remap-arete-organisation-fields.ts                  # dry run, staging
 *   pnpm tsx scripts/remap-arete-organisation-fields.ts --prod           # dry run, prod
 *   pnpm tsx scripts/remap-arete-organisation-fields.ts --prod --commit  # writes
 *
 * Both answers have been on every one of these applications since the day they
 * arrived — as `responses` entries, under the foundation's own question wording. What
 * they lacked was a column, so the application screen printed "not asked on the form"
 * beside a reserves figure the applicant had in fact given us, and described each
 * charity out of the Charity Commission's annual return while the charity's own
 * account of itself sat further down the page as question nineteen.
 *
 * The reserves question resolves through the common dictionary — Arete's wording
 * ("Your current unrestricted funding reserves. (£)") normalises onto an alias, so
 * every future submission maps itself. The summary question does not and never will:
 * "How does your charity support young people in Liverpool or the wider North West
 * achieve opportunity and potential?" is Arete's alone. It is passed here as a mapping
 * and persisted to their lookup table via `addToLookup`, which is exactly what a
 * reviewer pressing Confirm on the admin queue would do.
 *
 * WHY IT GOES THROUGH `resolveIngest` RATHER THAN AN UPDATE STATEMENT. Adding the two
 * columns is the small half of the change. The rest is that both answers must STOP
 * being responses: leave them, and the submission dialog shows each one twice, and the
 * Custodian score reads the summary as a form answer and as an organisation
 * description. `resolveIngest`'s confirm branch already does all of it — rewrites the
 * columns, recomputes `responses`, rewrites the `submitted_fields` index so the
 * dialog still renders the form in its original order, persists the lookup, and
 * re-runs the derived features whose inputs moved. Hand-rolled SQL would have to
 * reproduce five behaviours and would drift from them the next time one changes.
 *
 * THAT MEANS RE-SCORING. `responses` changes, so `updateApplicationFromCanonical`
 * re-runs the Custodian score for each application — thirteen model calls, roughly
 * forty seconds each. That is the point rather than a side effect: the score prompt
 * now carries the summary as its own section and the reserves as a stated figure, and
 * a score that had not read them would be answering a different question from the one
 * the screen beside it displays. The script REFUSES to commit without
 * `ANTHROPIC_API_KEY`, because scoring degrades to `pending` without one and would
 * quietly wipe thirteen scores a foundation has already read.
 *
 * Re-runnable: it recomputes the mapping from the stored payload every time and the
 * lookup upsert is idempotent, so a second run writes the same answer (and spends
 * another thirteen model calls, which is the reason to run it once).
 */

import { config } from 'dotenv'
config()

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import {
  buildCanonicalInput,
  computeResponses,
  resolvedFromMapping,
} from '../src/server/fieldMapping/assemble'
import { toStringValue } from '../src/lib/fieldMapping'
import { CreateApplicationSchema } from '../src/lib/validators/application'
import { resolveIngest } from '../src/server/fieldMapping/resolve'

const CLIENT_NAME = 'The Arete Foundation'

/** The Arete form question that answers "who are these people". */
const SUMMARY_KEY =
  'How does your charity support young people in Liverpool or the wider North West achieve opportunity and potential?'

/**
 * The reserves question. Listed here as well as in the common dictionary so this
 * script states the whole mapping it applies rather than half of it — and so a payload
 * whose key drifted (a trailing space, a different bracket) is REPORTED as unmatched
 * instead of silently falling back to the dictionary and looking like it worked.
 */
const RESERVES_KEY = 'Your current unrestricted funding reserves. (£)'

/** Who the audit trail records for the lookup rows this persists. */
const ACTOR = 'scripts/remap-arete-organisation-fields'

async function main() {
  const commit = process.argv.includes('--commit')
  const useProd = process.argv.includes('--prod')
  const env = readFileSync('.env', 'utf8')
  const url = useProd
    ? env.match(/^#\s*prod DATABASE_URL="([^"]+)"/m)?.[1]
    : process.env.DATABASE_URL
  if (!url) throw new Error('no DATABASE_URL for the chosen environment')
  // `resolveIngest` reaches the database through `getDb()`, which reads this on every
  // call — so pointing the whole server module tree at the chosen environment is one
  // assignment, and it has to happen before anything queries.
  process.env.DATABASE_URL = url
  const sql = neon(url)

  if (commit && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Confirming re-runs the Custodian score, and without ' +
        'a key scoring degrades to `pending` — this would wipe every existing score.',
    )
  }

  console.log(`${useProd ? 'PROD' : 'STAGING'} — ${commit ? 'COMMITTING' : 'dry run'}\n`)

  const rows = await sql`
    select i.id, i.raw_payload, i.resolved, i.provided_values, i.field_order,
           i.round_programme_id, i.application_id, i.status,
           a.organisation_name, a.responses
    from application_ingests i
    join clients c on c.id = i.client_id
    left join applications a on a.id = i.application_id
    where c.name = ${CLIENT_NAME}
    order by i.created_at`

  if (rows.length === 0) {
    console.log(`No ingests for ${CLIENT_NAME} in this environment — nothing to do.`)
    return
  }

  let changed = 0
  let written = 0

  for (const row of rows) {
    const payload = row.raw_payload as Record<string, unknown>
    const name = (row.organisation_name as string | null) ?? '(unpromoted)'

    // The mapping the pipeline applied, inverted: `resolved` is stored sourceKey →
    // canonicalField, and everything downstream of the reviewer's grid takes the
    // reverse. Passing it back unchanged is what makes this a confirm of the existing
    // mapping plus two fields, rather than a remap.
    const mapping: Record<string, string> = {}
    for (const [sourceKey, canonical] of Object.entries(
      (row.resolved ?? {}) as Record<string, string>,
    )) {
      mapping[canonical] = sourceKey
    }

    // Presence is judged with `toStringValue`, the same coercion the mapper uses, NOT
    // with a `typeof === 'string'` test. Arete's two most recent submissions came
    // through the direct Typeform webhook, which preserves JSON types, so their
    // reserves arrive as the number 183192 where the Make-era ones arrive as "183192".
    // A string test reads the newest rows as "not asked" and skips exactly the field
    // this script exists to add.
    const hasSummary = toStringValue(payload[SUMMARY_KEY]) !== ''
    const hasReserves = toStringValue(payload[RESERVES_KEY]) !== ''
    if (hasSummary) mapping.organisationSummary = SUMMARY_KEY
    if (hasReserves) mapping.unrestrictedReserves = RESERVES_KEY

    // Typed values the reviewer supplied (a delivery area read out of a prose answer,
    // a budget breakdown keyed in by hand). They consume no payload key and are stored
    // separately for exactly this reason: dropped here, the confirm would blank them.
    const values = (row.provided_values ?? {}) as Record<string, string>

    // Only the summary is taught. Reserves resolve through the common dictionary, and
    // copying that into one client's lookup table would put the same rule in two
    // places — the copy being the one nobody remembers to change.
    const addToLookup = hasSummary ? ['organisationSummary'] : []

    // What the confirm would produce, worked out here so a dry run reports the real
    // answer rather than a promise. `resolveIngest` recomputes all of this itself.
    const fieldOrder = (row.field_order ?? null) as string[] | null
    const resolved = resolvedFromMapping(payload, mapping, values)
    const responses = computeResponses(payload, resolved, fieldOrder)
    const parsed = CreateApplicationSchema.safeParse(
      buildCanonicalInput(row.round_programme_id as string, resolved, responses),
    )
    const before = ((row.responses ?? []) as unknown[]).length

    const summary = resolved.organisationSummary?.value
    const reserves = resolved.unrestrictedReserves?.value
    console.log(
      `${name}  [${row.status}]\n` +
        `  summary:   ${hasSummary ? `${summary!.length} chars` : 'NOT IN PAYLOAD'}\n` +
        `  reserves:  ${hasReserves ? `£${Number(reserves).toLocaleString('en-GB')}` : 'NOT IN PAYLOAD'}\n` +
        `  responses: ${before} → ${responses.length}` +
        `${parsed.success ? '' : `\n  ⚠ WOULD BE REFUSED: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`}`,
    )

    if (!hasSummary && !hasReserves) continue
    changed++
    if (!commit) continue

    const result = await resolveIngest(row.id as string, { mapping, values, addToLookup }, ACTOR)
    if (!result.ok) {
      console.log(
        `  ✗ ${result.error}${'fields' in result ? `: ${JSON.stringify(result.fields)}` : ''}`,
      )
      continue
    }
    written++
    console.log(`  ✓ updated=${result.updated} rerun=${result.rerun?.join(', ') || 'nothing'}`)
  }

  console.log(
    commit
      ? `\nWrote ${written} of ${changed} applications.`
      : `\nDry run — nothing written. ${changed} of ${rows.length} ingests would be confirmed.`,
  )
}

main()
