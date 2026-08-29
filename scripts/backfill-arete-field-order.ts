/**
 * One-off: give The Arete Foundation's existing submissions their real field order.
 *
 * `application_ingests.raw_payload` is jsonb, and Postgres normalises jsonb object
 * keys (by length, then bytewise). So every submission stored before `field_order`
 * existed came back in an order no applicant ever saw — "Contact Name, Contact Email,
 * programmeName, Charity Number…" — and `responses` inherited it. New submissions
 * capture the order at `saveIngest`; these sixteen cannot, because the order was
 * destroyed by the write that stored them.
 *
 * It is recoverable for Arete alone, because their form's running order is known
 * independently: it is the column order of the Typeform results export, supplied by
 * Alexandra on 2026-08-29 and recorded in `ARETE_FORM_ORDER` below. Every question
 * column in that export matches a stored payload key exactly (allowing for trailing
 * spaces, apostrophe characters and the newlines inside the declaration), which is
 * what makes this a restoration rather than a guess.
 *
 * Deliberately NOT generalised into a reusable backfill: no other foundation has an
 * export to restore from, and a script that quietly invented an order for one that
 * didn't would be worse than leaving the fallback ordering in place.
 *
 *   pnpm tsx scripts/backfill-arete-field-order.ts                 # dry run, staging
 *   pnpm tsx scripts/backfill-arete-field-order.ts --prod          # dry run, prod
 *   pnpm tsx scripts/backfill-arete-field-order.ts --prod --commit # writes
 *
 * Re-runnable: it recomputes from the payload every time and writes the same answer.
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { buildSubmittedFields, computeResponses } from '../src/server/fieldMapping/assemble'
import type { LookupResult } from '../src/lib/fieldMapping'

const CLIENT_NAME = 'The Arete Foundation'

/**
 * The Arete application form, in the order it is filled in.
 *
 * The question columns are the results export verbatim. Interleaved with them are the
 * seven keys that reach us but are not questions on the form — judgement calls, all of
 * them, and the reason this file exists rather than a one-line UPDATE:
 *
 *   the reference and the programme (`Submission ID`/`externalApplicationId`,
 *     `Form name`/`programmeName`) lead, standing where the export's "#" column does.
 *     Each pair is the same field under two names — the webhook synthesises the first,
 *     Make hand-canonicalised the second — so both appear and only the one present in a
 *     given payload survives.
 *   `Budget breakdown` sits with the budget upload question it answers.
 *   `Delivery area (added by Custodian admin)` sits with "Where are you based and where
 *     do you help?", the question it answers, rather than at the end: it was added by
 *     an admin, but it is still the answer to that question.
 *   `Submitted at` trails, where the export puts its Submit Date column.
 *
 * The export's own metadata columns (#, Response Type, Start/Stage/Submit Date) are
 * left out: they are the spreadsheet's, not the form's, and never arrive.
 */
const ARETE_FORM_ORDER = [
  'Submission ID',
  'externalApplicationId',
  'Form name',
  'programmeName',
  'Charity/Organisation Name',
  'Are you a registered charity?',
  'Charity Number',
  'Charity Registration Date',
  'Contact Name',
  'Contact Email',
  'Contact Telephone',
  'How does your charity support young people in Liverpool or the wider North West achieve opportunity and potential?',
  'Where are you based and where do you help?',
  'Delivery area (added by Custodian admin)',
  'Please give details on how many people are involved in the organisation (Full, Part-time, Volunteers, Trustees etc).',
  'Please list your trustees',
  'Please provide a brief summary re: your track record and history in supporting young people',
  'Our funding seeks to support young people aged up to 21 years (but we will consider ages beyond this) who are at-risk of becoming, or who are NEET. We wish for our grants to further access to educational or employment opportunities. Please confirm the project you are wishing to secure funds for.',
  'How much funding would you like to apply for? (Please note we typically offer long-term grants of between £2,500-5,000 per year on a 2 year commitment).',
  'Our preference is to provide funding for a programme or project in its entirety, or fund a majority share. Please confirm other sources of funding for this project/programme, if applicable',
  "Your organisation's total income in the last year. (£)",
  "Your organisation's total expenditure in the last year. (£)",
  "Your organisation's total salaries in the last year. (£)",
  'Your current unrestricted funding reserves. (£)',
  'Your current restricted funding reserves. (£)',
  'Please confirm the sources re: your restricted funding reserves',
  'Your balance at the time of application. (£)',
  "Your bank account's name.",
  "Your bank account's number.",
  "Your bank account's sort code.",
  'How will our funding be directed?',
  'Please upload a budget relating to your funding request (as a Microsoft Excel compatible file)',
  'Budget breakdown',
  'How many young people do you support a year?',
  'How do young people come to know of your charity?',
  'Please give ages or age ranges of the young people who you support',
  'Please confirm the number of beneficiaries to be supported as a result of the grant request',
  'Please confirm the age range of beneficiaries to be supported by the outcomes listed',
  'What are the main factors contributing to the young people you support being not in education, employment or training (NEET)?',
  'Other',
  'If you selected ‘Other’ in response to the previous question or wish to expand further, please briefly describe any additional or contextual factors.',
  'Please let us know any information you feel is important relating to the challenges the young people you support face',
  'By submitting this application I confirm that I am authorised to make this submission and sign this declaration.',
  'Submitted at',
]

/**
 * Match a stored key to a line above on meaning rather than bytes.
 *
 * The export and the payload disagree in three harmless ways — trailing spaces on the
 * money columns, straight vs curly apostrophes, and the declaration, which is one
 * cell in the spreadsheet and several paragraphs in the payload. Matching on the
 * normalised form absorbs all three; the key WRITTEN to `field_order` is always the
 * payload's own, never the export's, so nothing here can rename a field.
 */
const norm = (s: string) =>
  s
    .replace(/[‘’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * Does one normalised string extend the other — same question, more text?
 *
 * Two real cases, both of which must land beside the question they belong to rather
 * than at the end: the declaration, which is one cell in the export and several
 * paragraphs in the payload, and the "(full answer)" keys the later submissions carry
 * alongside the question they expand. The continuation has to begin on a boundary, so
 * a short line cannot swallow an unrelated key that merely starts with the same
 * letters ("Other" must not claim "Otherwise…").
 */
function extendsQuestion(longer: string, shorter: string): boolean {
  if (!longer.startsWith(shorter)) return false
  const next = longer.charAt(shorter.length)
  return next === '' || !/[a-z0-9]/.test(next)
}

function orderFor(payloadKeys: string[]): { order: string[]; unplaced: string[] } {
  const remaining = new Map(payloadKeys.map((k) => [k, norm(k)]))
  const order: string[] = []
  for (const line of ARETE_FORM_ORDER) {
    const n = norm(line)
    // ALL the keys belonging to this question, not just the first: a question and its
    // "(full answer)" are two payload keys answering one line of the export, and
    // taking one and leaving the other stranded the expansion at the end of the form,
    // several screens from the question it expands. Shortest first, so the answer
    // precedes its own elaboration.
    const hits = [...remaining]
      .filter(([, keyNorm]) => extendsQuestion(keyNorm, n) || extendsQuestion(n, keyNorm))
      .sort((a, b) => a[1].length - b[1].length)
    for (const [key] of hits) {
      order.push(key)
      remaining.delete(key)
    }
  }
  // A key the form order says nothing about keeps its place at the end rather than
  // being dropped: `orderedKeys` would append it anyway, and a field that arrived and
  // is not rendered is the lost-field failure this whole feature exists to prevent.
  return { order: [...order, ...remaining.keys()], unplaced: [...remaining.keys()] }
}

async function main() {
  const commit = process.argv.includes('--commit')
  const useProd = process.argv.includes('--prod')
  const env = readFileSync('.env', 'utf8')
  const url = useProd
    ? env.match(/^#\s*prod DATABASE_URL="([^"]+)"/m)?.[1]
    : process.env.DATABASE_URL
  if (!url) throw new Error('no DATABASE_URL for the chosen environment')
  const sql = neon(url)

  console.log(`${useProd ? 'PROD' : 'STAGING'} — ${commit ? 'COMMITTING' : 'dry run'}\n`)

  const rows = await sql`
    select i.id, i.raw_payload, i.resolved, i.provided_values, i.application_id, i.created_at
    from application_ingests i join clients c on c.id = i.client_id
    where c.name = ${CLIENT_NAME}
    order by i.created_at`

  if (rows.length === 0) {
    console.log(`No ingests for ${CLIENT_NAME} in this environment — nothing to do.`)
    return
  }

  let ingestsWritten = 0
  let applicationsWritten = 0

  for (const row of rows) {
    const payload = row.raw_payload as Record<string, unknown>
    const { order, unplaced } = orderFor(Object.keys(payload))

    // Rebuild the resolved map the pipeline had: `resolved` is stored as
    // sourceKey → canonicalField, the inverse of what the helpers take. Provided
    // values are left out on purpose — they consumed no payload key, so they have no
    // place in the submission's running order.
    const resolved: LookupResult['resolved'] = {}
    for (const [sourceKey, canonical] of Object.entries(
      (row.resolved ?? {}) as Record<string, string>,
    )) {
      const value = payload[sourceKey]
      if (value == null || value === '') continue
      resolved[canonical as keyof typeof resolved] = {
        sourceKey,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }
    }

    const submittedFields = buildSubmittedFields(payload, resolved, order)
    const responses = computeResponses(payload, resolved, order)

    const date = (row.created_at as Date).toISOString().slice(0, 10)
    console.log(
      `${date}  ${String(Object.keys(payload).length).padStart(2)} fields` +
        `  → ${submittedFields.length} indexed, ${responses.length} responses` +
        `${unplaced.length ? `  ⚠ unplaced: ${JSON.stringify(unplaced)}` : ''}`,
    )
    if (process.argv.includes('--verbose')) {
      submittedFields.forEach((f, i) =>
        console.log(
          `          ${String(i + 1).padStart(2)}. ${f.canonical ? `[${f.canonical}] ` : ''}${f.label}`,
        ),
      )
    } else {
      console.log(
        `          first five: ${submittedFields
          .slice(0, 5)
          .map((f) => f.label)
          .join(' · ')}`,
      )
    }

    if (!commit) continue

    await sql`update application_ingests set field_order = ${JSON.stringify(order)}::jsonb
              where id = ${row.id}`
    ingestsWritten++

    if (row.application_id) {
      // `responses` is rewritten as well as the index. It is a permutation — same
      // labels, same values — but it is stored in the scrambled order too, and
      // anything reading it directly (the Custodian score prompt, on any future
      // re-score) would otherwise still see the jumble.
      await sql`update applications
                set submitted_fields = ${JSON.stringify(submittedFields)}::jsonb,
                    responses = ${JSON.stringify(responses)}::jsonb
                where id = ${row.application_id}`
      applicationsWritten++
    }
  }

  console.log(
    commit
      ? `\nWrote ${ingestsWritten} ingests and ${applicationsWritten} applications.`
      : `\nDry run — nothing written. ${rows.length} ingests would be updated.`,
  )
}

main()
