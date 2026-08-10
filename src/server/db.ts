import { drizzle } from 'drizzle-orm/neon-http'
import { neon, neonConfig } from '@neondatabase/serverless'
import * as schema from '../../drizzle/schema'

/**
 * How long a single query may take before we give up on it.
 *
 * Cloudflare puts **no** timeout on a Worker's outbound fetch. When the connection to
 * Neon goes half-open — which is what happens when the compute autosuspends and the
 * socket is dropped without a clean close — a query is written into a dead connection
 * and the request hangs until the *browser* gives up, minutes later. On 9 Aug 2026 that
 * left a "Creating…" spinner running for six minutes in production; two other requests
 * hung for 36. Because a hang throws nothing, Sentry had nothing to report, and the
 * Neon compute never woke — the queries never arrived.
 *
 * 4s is generous against real latency: queries here answer in 20-300ms, and the slowest
 * legitimate case — one that has to wake a suspended compute — was ~1s.
 */
const QUERY_TIMEOUT_MS = 4_000

/**
 * One retry, and only one. It helps because aborting the first attempt makes the
 * runtime discard the poisoned connection, so the second gets a fresh one. If a fresh
 * connection fails too, the problem is not the connection and waiting longer is just a
 * slower way to show the same error.
 */
const RETRIES = 1

/**
 * Queries slower than this get a log line. Degradation *below* QUERY_TIMEOUT_MS never
 * errors, so without this it stays invisible right up until it crosses 4s and starts
 * failing people. Workers Logs records the request that hung but nothing about what it
 * was waiting on — this is the line that would have made 9 Aug a one-minute diagnosis.
 */
const SLOW_QUERY_MS = 2_000

const DB_TIMEOUT = 'DatabaseTimeout' as const

interface DatabaseTimeoutError extends Error {
  name: typeof DB_TIMEOUT
  /** Whether the statement could have changed data. Decides both whether a retry is
   *  allowed and what the user is told. */
  isWrite: boolean
}

/**
 * The fetch every Neon query goes through: bounded, retried once when that is safe,
 * and noisy when slow.
 *
 * Installed globally on `neonConfig` rather than passed per call, so it covers every
 * query in the app including ones written later — there is no opt-in to forget.
 */
async function queryFetch(url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const startedAt = Date.now()
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
      })
      warnIfSlow(Date.now() - startedAt, init)
      return response
    } catch (cause) {
      // A write that timed out may still have COMMITTED — what went missing might be
      // only the response. That is not hypothetical: on 9 Aug an INSERT landed in the
      // database while its caller sat spinning, so an automatic retry would have
      // created a second row. Reads carry no such risk.
      const isWrite = couldWrite(init)
      if (isWrite || attempt >= RETRIES) throw timeoutError(cause, isWrite)
    }
  }
}

/**
 * Whether this request could change data.
 *
 * Read-only is the claim that has to be *proven*, so anything unrecognised counts as a
 * write: guessing wrong in that direction duplicates a grant, guessing wrong in the
 * other only costs a retry. CTEs are deliberately not treated as reads — `WITH … UPDATE`
 * writes, and separating those from `WITH … SELECT` is not worth the risk.
 */
function couldWrite(init?: RequestInit): boolean {
  const statements = statementsIn(init)
  if (statements.length === 0) return true
  return !statements.every((statement) => /^\s*select\b/i.test(statement))
}

/** The SQL in a Neon request body: one `query`, or several under `queries` for a batch. */
function statementsIn(init?: RequestInit): string[] {
  try {
    const body = JSON.parse(String(init?.body)) as {
      query?: string
      queries?: Array<{ query?: string }>
    }
    const statements = body.queries ? body.queries.map((q) => q.query) : [body.query]
    return statements.filter((s): s is string => typeof s === 'string')
  } catch {
    return []
  }
}

function timeoutError(cause: unknown, isWrite: boolean): DatabaseTimeoutError {
  const error = new Error(
    `Database did not answer within ${QUERY_TIMEOUT_MS}ms (${isWrite ? 'write' : 'read'})`,
    { cause },
  ) as DatabaseTimeoutError
  error.name = DB_TIMEOUT
  error.isWrite = isWrite
  return error
}

/** Parameters travel separately from the SQL, so the text logged holds `$1` placeholders
 *  rather than anyone's data. */
function warnIfSlow(elapsedMs: number, init?: RequestInit): void {
  if (elapsedMs < SLOW_QUERY_MS) return
  const [statement] = statementsIn(init)
  console.warn(`[db] slow query ${elapsedMs}ms: ${(statement ?? 'unknown').slice(0, 120)}`)
}

/**
 * A database timeout, recognised after Neon has wrapped it: `neon()` catches whatever
 * the fetch threw and re-throws its own `NeonDbError`, keeping the original on
 * `sourceError`.
 */
export function databaseTimeout(err: unknown): { isWrite: boolean } | null {
  const source = (err as { sourceError?: unknown } | null)?.sourceError ?? err
  if ((source as { name?: unknown } | null)?.name !== DB_TIMEOUT) return null
  return { isWrite: (source as DatabaseTimeoutError).isWrite }
}

let configured = false

// Lazy init so that this module can be imported on the client (via the
// createServerFn module graph) without throwing — neon() is only called
// when a server function actually runs a query.
export function getDb() {
  if (!configured) {
    neonConfig.fetchFunction = queryFetch
    configured = true
  }
  return drizzle(neon(process.env['DATABASE_URL'] ?? 'postgresql://localhost/unused'), { schema })
}
