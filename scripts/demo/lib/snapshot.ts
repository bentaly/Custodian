// ─── Demo dataset: the pipeline snapshot ─────────────────────────────────────
//
// Types and loading for the recorded pipeline output. See `scripts/demo/snapshot.ts`
// for what it is and why it exists.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SNAPSHOT_DIR = join(HERE, '..', 'snapshot')
const SNAPSHOT_FILE = join(SNAPSHOT_DIR, 'pipeline.json')

export interface ApplicationSnapshot {
  dueDiligenceStatus: string
  dueDiligenceChecks: Array<{
    key: string
    source: string
    result: string
    detail: string | null
  }> | null
  dueDiligenceCheckedAt: string | null
  custodianScoreStatus: string
  custodianScore: number | null
  custodianScoreDetail: Record<string, unknown> | null
  custodianScoredAt: string | null
  grantPurpose: string | null
  deprivationStatus: string
  deprivationContext: Record<string, unknown> | null
  deprivationResolvedAt: string | null
  deliveryNation: string | null
  deliveryRegion: string | null
  deliveryLadCode: string | null
  deliveryLadName: string | null
  bankCheckStatus: string | null
}

export interface ReportSnapshot {
  analysisStatus: string
  aiSummary: string | null
  applicationAlignment: {
    score: number
    narrative: string
    promisesKept: string[]
    promisesUnmet: string[]
  } | null
  programmeAlignment: { score: number; narrative: string } | null
  aiChallenges: string | null
  aiLessons: string | null
  impactQuantity: string | null
  impactQuantitySource: string | null
  impactQuantityQuote: string | null
  impactUnitLabel: string | null
  analysisDetail: Record<string, unknown> | null
  analysedAt: string | null
}

export interface PipelineSnapshot {
  fixtureHash: string
  capturedAt: string
  applications: Record<string, ApplicationSnapshot>
  reports: Record<string, ReportSnapshot>
}

/**
 * A hash of the narrative content the pipeline was run against.
 *
 * The snapshot pairs a reference with an assessment of specific text. Edit the text and
 * the assessment no longer describes it — so a replay against changed narratives would
 * quietly show a score that was never given to the application on screen. Hashing the
 * two fixture files catches that: `--replay` warns rather than lying.
 */
export function fixtureHash(): string {
  const h = createHash('sha256')
  for (const f of ['applications.ts', 'reports.ts']) {
    h.update(readFileSync(join(HERE, f)))
  }
  return h.digest('hex').slice(0, 16)
}

export function snapshotExists(): boolean {
  return existsSync(SNAPSHOT_FILE)
}

/** Load the recorded pipeline output, or null when none has been captured. */
export function loadSnapshot(): PipelineSnapshot | null {
  if (!snapshotExists()) return null
  return JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as PipelineSnapshot
}

/** Warn (loudly, once) when the recording no longer matches the narratives. */
export function warnIfStale(snapshot: PipelineSnapshot): void {
  const current = fixtureHash()
  if (snapshot.fixtureHash === current) return
  console.log(
    `\n  ⚠️  The fixture has changed since this snapshot was captured\n` +
      `      snapshot: ${snapshot.fixtureHash}   fixture now: ${current}\n` +
      `      Replayed scores describe the OLD narratives. Re-run the live pipeline\n` +
      `      (\`pnpm demo:apply --live\`) and \`pnpm demo:snapshot\` to re-record.\n`,
  )
}
