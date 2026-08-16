// `pnpm demo:snapshot` — capture the pipeline's output so it never has to be paid for twice.
//
// `demo:apply` and `demo:report` run the real pipeline: model calls, live register
// lookups, deprivation resolution. That is what makes the dataset honest, and it costs
// money and the better part of an hour. But the applications are STATIC — the same
// forty narratives produce the same assessment every time — so paying again to reshape
// a round date or an award status is pure waste.
//
// This writes the AI- and register-produced columns to `snapshot/`, keyed by the
// foundation's own reference. `demo:apply --replay` and `demo:report --replay` then
// rebuild the dataset from it in seconds, for nothing.
//
// The snapshot is a RECORDING of a real run, not hand-written data: every value in it
// was produced by the live pipeline from the narratives in `lib/applications.ts`. Change
// those narratives and the recording is stale — which is why `--replay` refuses to run
// against a snapshot whose content hash no longer matches the fixture.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { getDb } from '../../src/server/db'
import { requireDemoClient, runScript, step, done } from './lib/shared'
import {
  SNAPSHOT_DIR,
  fixtureHash,
  type ApplicationSnapshot,
  type ReportSnapshot,
} from './lib/snapshot'

runScript('demo:snapshot', async () => {
  const db = getDb()
  const client = await requireDemoClient()
  const clientId = client.id

  step('Reading application pipeline output')
  const appRows = await db.execute(sql`
    select a.external_application_id ref,
           a.due_diligence_status, a.due_diligence_checks, a.due_diligence_checked_at,
           a.custodian_score_status, a.custodian_score, a.custodian_score_detail,
           a.custodian_scored_at, a.grant_purpose,
           a.deprivation_status, a.deprivation_context, a.deprivation_resolved_at,
           a.delivery_nation, a.delivery_region, a.delivery_lad_code, a.delivery_lad_name,
           a.bank_check_status
    from applications a
    join round_programmes rp on rp.id = a.round_programme_id
    join rounds ro on ro.id = rp.round_id
    where ro.client_id = ${clientId} and a.external_application_id is not null
    order by a.external_application_id
  `)

  const applications: Record<string, ApplicationSnapshot> = {}
  for (const r of appRows.rows as Array<Record<string, unknown>>) {
    applications[r.ref as string] = {
      dueDiligenceStatus: r.due_diligence_status as string,
      dueDiligenceChecks: r.due_diligence_checks as ApplicationSnapshot['dueDiligenceChecks'],
      dueDiligenceCheckedAt: r.due_diligence_checked_at as string | null,
      custodianScoreStatus: r.custodian_score_status as string,
      custodianScore: r.custodian_score as number | null,
      custodianScoreDetail: r.custodian_score_detail as ApplicationSnapshot['custodianScoreDetail'],
      custodianScoredAt: r.custodian_scored_at as string | null,
      grantPurpose: r.grant_purpose as string | null,
      deprivationStatus: r.deprivation_status as string,
      deprivationContext: r.deprivation_context as ApplicationSnapshot['deprivationContext'],
      deprivationResolvedAt: r.deprivation_resolved_at as string | null,
      deliveryNation: r.delivery_nation as string | null,
      deliveryRegion: r.delivery_region as string | null,
      deliveryLadCode: r.delivery_lad_code as string | null,
      deliveryLadName: r.delivery_lad_name as string | null,
      bankCheckStatus: r.bank_check_status as string | null,
    }
  }
  done(`${Object.keys(applications).length} applications`)

  step('Reading report pipeline output')
  const reportRows = await db.execute(sql`
    select r.external_application_id ref,
           r.analysis_status, r.ai_summary, r.application_alignment, r.programme_alignment,
           r.ai_challenges, r.ai_lessons, r.impact_quantity, r.impact_quantity_source,
           r.impact_quantity_quote, r.impact_unit_label, r.analysis_detail, r.analysed_at
    from reports r
    where r.client_id = ${clientId} and r.external_application_id is not null
    order by r.external_application_id
  `)

  const reports: Record<string, ReportSnapshot> = {}
  for (const r of reportRows.rows as Array<Record<string, unknown>>) {
    reports[r.ref as string] = {
      analysisStatus: r.analysis_status as string,
      aiSummary: r.ai_summary as string | null,
      applicationAlignment: r.application_alignment as ReportSnapshot['applicationAlignment'],
      programmeAlignment: r.programme_alignment as ReportSnapshot['programmeAlignment'],
      aiChallenges: r.ai_challenges as string | null,
      aiLessons: r.ai_lessons as string | null,
      impactQuantity: r.impact_quantity as string | null,
      impactQuantitySource: r.impact_quantity_source as string | null,
      impactQuantityQuote: r.impact_quantity_quote as string | null,
      impactUnitLabel: r.impact_unit_label as string | null,
      analysisDetail: r.analysis_detail as Record<string, unknown> | null,
      analysedAt: r.analysed_at as string | null,
    }
  }
  done(`${Object.keys(reports).length} reports`)

  step('Writing snapshot')
  mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const payload = {
    // Ties the recording to the narratives that produced it. `--replay` checks this and
    // refuses a stale snapshot rather than silently pairing new text with old scores.
    fixtureHash: fixtureHash(),
    capturedAt: new Date().toISOString(),
    applications,
    reports,
  }
  const file = join(SNAPSHOT_DIR, 'pipeline.json')
  writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  done(`${file}`)
  console.log(`\n  fixture hash: ${payload.fixtureHash}`)
  console.log('  commit this file — it is what makes a re-seed free.\n')
})
