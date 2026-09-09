// ─── Generating one foundation's summary ─────────────────────────────────────
//
// The unit of work a queue message stands for: read the portfolio, call the model,
// verify what comes back, write one row. Never throws — the outcome is the return
// value, so a message that cannot succeed is not retried into the dead-letter queue.
//
// It re-checks the census itself rather than trusting the dispatcher's decision.
// The message carries only a client id (the rule every `PipelineMessage` follows),
// so by the time it runs the world may have moved: two messages for the same client
// can be in flight after a redelivery, and the second one arriving to find nothing
// changed should cost nothing rather than a second model call for the same answer.

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { insightAnalyses } from '../../../drizzle/schema'
import type { PortfolioAnalysisResult, PortfolioBrief } from '../../lib/portfolioAnalysis'
import { buildClientBrief } from './brief'
import { takeCensus } from './dispatch'
import { runPortfolioAnalysis, type PortfolioAssessor } from './run'

export type GenerateOutcome =
  /** Nothing has changed since the last summary. No model call, no row. */
  | { status: 'unchanged'; clientId: string }
  /** No awarded grants yet — the screen shows its empty state instead. */
  | { status: 'no_grants'; clientId: string }
  | {
      status: 'analysed' | 'pending' | 'error'
      clientId: string
      summary: string | null
      detail: Record<string, unknown> | null
      /** Returned on a dry run so a prompt edit can be judged without writing. */
      brief?: PortfolioBrief
      written: boolean
    }

export interface GenerateOptions {
  force?: boolean
  /** Render everything and return it, writing nothing. */
  dryRun?: boolean
  /** Injected in tests, so the whole path runs without an API call. */
  assess?: PortfolioAssessor
}

export async function generatePortfolioAnalysis(
  clientId: string,
  opts: GenerateOptions = {},
): Promise<GenerateOutcome> {
  const db = getDb()

  const [census] = await takeCensus(db, clientId)
  if (!census) return { status: 'no_grants', clientId }

  if (!opts.force) {
    const [latest] = await db
      .select({ fingerprint: insightAnalyses.inputFingerprint })
      .from(insightAnalyses)
      .where(eq(insightAnalyses.clientId, clientId))
      .orderBy(sql`${insightAnalyses.generatedAt} desc`)
      .limit(1)
    if (latest && latest.fingerprint === census.fingerprint) {
      return { status: 'unchanged', clientId }
    }
  }

  const { brief, grantCount } = await buildClientBrief(db, clientId)
  if (grantCount === 0) return { status: 'no_grants', clientId }

  const result: PortfolioAnalysisResult = await runPortfolioAnalysis(brief, {
    ...(opts.assess ? { assess: opts.assess } : {}),
  })

  if (opts.dryRun) {
    return {
      status: result.status,
      clientId,
      summary: result.output?.summary ?? null,
      detail: result.detail,
      brief,
      written: false,
    }
  }

  // The fingerprint is written on every outcome, `error` included. A model failure
  // that is recorded and then re-attempted every three hours against data nobody has
  // touched is a foundation's whole portfolio re-analysed eight times a day for as
  // long as the failure lasts; the next real change re-runs it anyway.
  await db.insert(insightAnalyses).values({
    clientId,
    status: result.status,
    summary: result.output?.summary ?? null,
    figuresCited: result.output?.figuresCited ?? null,
    brief,
    inputFingerprint: census.fingerprint,
    detail: result.detail,
    generatedAt: new Date(result.generatedAt),
  })

  return {
    status: result.status,
    clientId,
    summary: result.output?.summary ?? null,
    detail: result.detail,
    written: true,
  }
}
