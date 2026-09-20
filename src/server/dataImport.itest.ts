import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'

/**
 * The onboarding import, against a real database, asserted on the rows it wrote.
 *
 * ## Why this suite exists
 *
 * On 2026-09-20 a foundation imported its back catalogue and four things went wrong at
 * once: every created round was stamped with today's date (so the live round looked
 * deleted), their pairings were given a £0 budget (so closed rounds read as permanently
 * overspent), a corrected re-upload left two empty rounds nothing could remove, and a
 * delivery area of "North West" reported Scotland.
 *
 * Only the last was findable by a unit test. The other three lived in
 * `src/server/fns/dataImport.ts`, which had 1,100 lines and no tests at all, while
 * `src/lib/dataImport/*` had seventy-five. That is the wrong way round: the pure half
 * decides whether a cell is a date, and the IO half is the only code in the app that
 * DELETES a foundation's rows.
 *
 * ## The shape
 *
 * One complete tenant per run, built and torn down. Assertions are made against what is
 * in the database afterwards, never against what the function returned, because a return
 * value cannot tell you that a round was left behind.
 *
 * Session and queue are mocked; nothing else is. The queue mock is not a convenience —
 * without it a commit fires a real geocode and two registry lookups per grant.
 */

const RUN = randomUUID().slice(0, 8)
const MARKER = `imp-${RUN}`

/** Who the server functions think is calling. Set once the fixture has a client. */
const caller = {
  id: `user-${MARKER}`,
  name: 'Import fixture',
  email: `${MARKER}@wrenfield.example`,
  role: 'admin' as const,
  clientId: '',
}

/**
 * A server function, called directly.
 *
 * `createServerFn` wraps its handler in TanStack's middleware, which reads a Start
 * context out of AsyncLocalStorage that only exists inside a real request. The mock
 * keeps the two things that matter here — the zod validator (which is the door to the
 * database, so it must still run) and the `{ data }` shape the handler destructures —
 * and drops the transport. What is under test is what the handler writes, not how
 * TanStack routes a POST.
 */
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const api = {
      schema: null as { parse: (input: unknown) => unknown } | null,
      validator(schema: { parse: (input: unknown) => unknown }) {
        api.schema = schema
        return api
      },
      handler(fn: (args: { data: unknown }) => unknown) {
        return (input?: { data?: unknown }) =>
          fn({ data: api.schema ? api.schema.parse(input?.data) : input?.data })
      },
    }
    return api
  },
}))

vi.mock('./session', () => ({
  requireAuthUser: async () => caller,
  requireRole: async () => caller,
  getAuthUser: async () => caller,
}))

// Every grant queues a geocode and two registry screenings. Left real, one commit of
// twenty grants would make sixty outbound calls and charge for the geocoding.
const queued: unknown[] = []
vi.mock('./pipelineQueue', () => ({
  enqueue: async (message: unknown) => (queued.push(message), 'queued' as const),
  enqueueMany: async (messages: unknown[]) => (queued.push(...messages), 'queued' as const),
}))

const { getDb } = await import('./db')
const { assertWritableDatabase } = await import('../../scripts/demo/lib/shared')
const { teardownDemo } = await import('../../scripts/demo/lib/teardown')
const { commitImport, rollbackImport, prepareImport, fanOutImportDerivations } = await import(
  './fns/dataImport'
)
const { financeList } = await import('./fns/finance')
const { MAX_GRANTS_PER_IMPORT } = await import('../lib/dataImport/validate')
const schema = await import('../../drizzle/schema')
const { applications, awardInstalments, awards, clients, programmes, roundProgrammes, rounds, users } =
  schema

type Fixture = {
  clientId: string
  programmeId: string
  programmeName: string
  otherProgrammeId: string
  liveRoundId: string
  liveRoundName: string
}

let fx: Fixture

beforeAll(async () => {
  assertWritableDatabase()
  const db = getDb()

  const [client] = await db
    .insert(clients)
    .values({ name: `Import fixture ${MARKER}` })
    .returning()
  const [programme] = await db
    .insert(programmes)
    .values({ clientId: client!.id, name: `Youth ${MARKER}`, tags: ['Youth', 'Mental health'] })
    .returning()
  const [other] = await db
    .insert(programmes)
    .values({ clientId: client!.id, name: `Place ${MARKER}`, tags: ['Place'] })
    .returning()
  // A round the foundation already runs, with a budget it chose. Nothing the import does
  // may touch this: it is the control for every "only rows we created" rule below.
  const [live] = await db
    .insert(rounds)
    .values({
      clientId: client!.id,
      name: `Live round ${MARKER}`,
      openedAt: new Date('2026-06-01'),
      closedAt: new Date('2026-08-31'),
    })
    .returning()
  await db
    .insert(roundProgrammes)
    .values({ roundId: live!.id, programmeId: programme!.id, budget: '250000' })
  await db.insert(users).values({
    id: caller.id,
    clientId: client!.id,
    name: caller.name,
    email: caller.email,
    role: 'admin',
  })

  caller.clientId = client!.id
  fx = {
    clientId: client!.id,
    programmeId: programme!.id,
    programmeName: programme!.name,
    otherProgrammeId: other!.id,
    liveRoundId: live!.id,
    liveRoundName: live!.name,
  }
})

afterAll(async () => {
  if (fx?.clientId) await teardownDemo(fx.clientId)
})

// ─── Workbook builders ───────────────────────────────────────────────────────

let rowNumber = 1

type GrantOverrides = Partial<Parameters<typeof grantRow>[0]>

function grantRow(o: {
  reference: string
  round: string
  organisationName?: string
  programme?: string
  awardDate?: string
  amountAwarded?: number
  amountPaid?: number | null
  status?: 'active' | 'completed' | 'cancelled'
  endDate?: string | null
  deliveryArea?: string | null
  themes?: string[]
}) {
  return {
    rowNumber: rowNumber++,
    reference: o.reference,
    organisationName: o.organisationName ?? `Grantee ${o.reference} ${MARKER}`,
    programme: o.programme ?? fx.programmeName,
    round: o.round,
    awardDate: o.awardDate ?? '2022-06-01',
    amountAwarded: o.amountAwarded ?? 10_000,
    amountPaid: o.amountPaid ?? 10_000,
    status: o.status ?? ('completed' as const),
    charityNumber: '1234567',
    companyNumber: null,
    contactEmail: null,
    deliveryArea: o.deliveryArea ?? 'Preston',
    purpose: 'Core costs',
    themes: o.themes ?? [],
    endDate: o.endDate === undefined ? '2023-05-31' : o.endDate,
    impactQuantity: null,
    bankAccountName: null,
    bankSortCode: null,
    bankAccountNumber: null,
  }
}

/** A commit exactly as the review screen posts one: every round is "create it" unless
 *  the caller says otherwise. */
async function commit(
  grants: ReturnType<typeof grantRow>[],
  opts: {
    payments?: Array<{ reference: string; dueDate: string; amount: number; paid: boolean }>
    rounds?: Record<string, string | null>
  } = {},
) {
  const roundMapping: Record<string, string | null> = {}
  for (const g of grants) roundMapping[g.round] = opts.rounds?.[g.round] ?? null
  return commitImport({
    data: {
      payload: {
        grants,
        payments: (opts.payments ?? []).map((p) => ({
          rowNumber: rowNumber++,
          reference: p.reference,
          dueDate: p.dueDate,
          amount: p.amount,
          paid: p.paid,
          paidDate: p.paid ? p.dueDate : null,
        })),
        reports: [],
        cellIssues: [],
      },
      mapping: {
        programmes: { [fx.programmeName]: fx.programmeId },
        rounds: roundMapping,
        themes: {},
      },
      fileName: `${MARKER}.xlsx`,
      acceptedWarnings: [],
    },
  })
}

/** This client's rounds, with what hangs off each one. */
async function roundState() {
  const rows = await getDb().query.rounds.findMany({
    where: (r, { eq: e }) => e(r.clientId, fx.clientId),
    with: { roundProgrammes: { with: { applications: { columns: { id: true } } } } },
  })
  return rows.map((r) => ({
    name: r.name,
    openedAt: r.openedAt?.toISOString().slice(0, 10) ?? null,
    closedAt: r.closedAt?.toISOString().slice(0, 10) ?? null,
    importBatchId: r.importBatchId,
    budgets: r.roundProgrammes.map((rp) => rp.budget),
    grants: r.roundProgrammes.reduce((n, rp) => n + rp.applications.length, 0),
  }))
}

// ─── The tests ───────────────────────────────────────────────────────────────

describe('a round the workbook names but the foundation does not have', () => {
  it('is created, dated from its own decisions, and given no budget', async () => {
    const name = `Autumn 2021 ${MARKER}`
    await commit([
      grantRow({ reference: `${MARKER}-A1`, round: name, awardDate: '2021-11-03' }),
      grantRow({ reference: `${MARKER}-A2`, round: name, awardDate: '2021-09-14' }),
    ])

    const created = (await roundState()).find((r) => r.name === name)!
    expect(created).toBeDefined()
    // The bug this replaces stamped `new Date()`, which made a 2021 round the most
    // recent the foundation had ever run.
    expect(created.openedAt).toBe('2021-09-14')
    expect(created.closedAt).toBe('2021-11-03')
    // NULL, not '0': "not set" and "a budget of nothing" are different answers, and the
    // second reads as a round permanently overspent.
    expect(created.budgets).toEqual([null])
    expect(created.importBatchId).not.toBeNull()
  })

  it('leaves a round the foundation made alone, budget and dates intact', async () => {
    await commit([grantRow({ reference: `${MARKER}-B1`, round: fx.liveRoundName })], {
      rounds: { [fx.liveRoundName]: fx.liveRoundId },
    })

    const live = (await roundState()).find((r) => r.name === fx.liveRoundName)!
    expect(live.openedAt).toBe('2026-06-01')
    expect(live.budgets).toEqual(['250000'])
    expect(live.importBatchId).toBeNull()
  })
})

describe('a completed grant with no payment rows', () => {
  it('becomes one paid instalment dated at the grant end', async () => {
    const ref = `${MARKER}-C1`
    await commit([
      grantRow({
        reference: ref,
        round: `Lump sum ${MARKER}`,
        amountAwarded: 24_000,
        amountPaid: 24_000,
        endDate: '2024-03-31',
      }),
    ])

    const app = await getDb().query.applications.findFirst({
      where: (a, { eq: e }) => e(a.externalApplicationId, ref),
    })
    const instalments = await getDb()
      .select()
      .from(awardInstalments)
      .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
      .where(eq(awards.applicationId, app!.id))
    expect(instalments).toHaveLength(1)
    expect(instalments[0]!.award_instalments.amount).toBe('24000')
    expect(instalments[0]!.award_instalments.paidDate).toBe('2024-03-31')
  })
})

describe('re-uploading a corrected workbook', () => {
  it('replaces the grant rather than duplicating it, and clears the round it left empty', async () => {
    const ref = `${MARKER}-D1`
    const wrongRound = `Typo round ${MARKER}`
    const rightRound = `Correct round ${MARKER}`

    await commit([grantRow({ reference: ref, round: wrongRound, amountAwarded: 5_000 })])
    expect((await roundState()).find((r) => r.name === wrongRound)?.grants).toBe(1)

    await commit([grantRow({ reference: ref, round: rightRound, amountAwarded: 7_500 })])

    const after = await roundState()
    // The grant moved, and is not in both places.
    expect(after.find((r) => r.name === rightRound)?.grants).toBe(1)
    // The round the import invented for the typo is gone, not left in every round
    // picker the foundation has. This is where "July 2022" and "April 2025" came from.
    expect(after.find((r) => r.name === wrongRound)).toBeUndefined()

    const matching = await getDb()
      .select({ id: applications.id, amount: applications.amountRequested })
      .from(applications)
      .where(eq(applications.externalApplicationId, ref))
    expect(matching).toHaveLength(1)
    expect(matching[0]!.amount).toBe('7500')
  })
})

describe('rollback', () => {
  it('takes the grants and the rounds that batch invented, and nothing else', async () => {
    const name = `Rollback round ${MARKER}`
    const result = await commit([
      grantRow({ reference: `${MARKER}-E1`, round: name }),
      grantRow({ reference: `${MARKER}-E2`, round: name }),
    ])

    const undone = await rollbackImport({ data: { batchId: result.batchId } })
    expect(undone.removed).toBe(2)

    const after = await roundState()
    expect(after.find((r) => r.name === name)).toBeUndefined()
    // The control: a round the foundation made survives its own grants being withdrawn.
    expect(after.find((r) => r.name === fx.liveRoundName)).toBeDefined()
  })
})

describe('the door', () => {
  it('refuses a programme id that belongs to another foundation', async () => {
    const db = getDb()
    const [stranger] = await db
      .insert(clients)
      .values({ name: `Stranger ${MARKER}` })
      .returning()
    const [theirs] = await db
      .insert(programmes)
      .values({ clientId: stranger!.id, name: `Theirs ${MARKER}` })
      .returning()

    await expect(
      commitImport({
        data: {
          payload: {
            grants: [grantRow({ reference: `${MARKER}-F1`, round: `Door ${MARKER}` })],
            payments: [],
            reports: [],
            cellIssues: [],
          },
          mapping: {
            programmes: { [fx.programmeName]: theirs!.id },
            rounds: { [`Door ${MARKER}`]: null },
            themes: {},
          },
          fileName: null,
          acceptedWarnings: [],
        },
      }),
    ).rejects.toThrow()

    await db.delete(programmes).where(eq(programmes.id, theirs!.id))
    await db.delete(clients).where(eq(clients.id, stranger!.id))
  })

  it('refuses a round id that belongs to another foundation', async () => {
    const db = getDb()
    const [stranger] = await db
      .insert(clients)
      .values({ name: `Stranger round ${MARKER}` })
      .returning()
    const [theirRound] = await db
      .insert(rounds)
      .values({ clientId: stranger!.id, name: `Their round ${MARKER}` })
      .returning()

    const name = `Door round ${MARKER}`
    await expect(
      commit([grantRow({ reference: `${MARKER}-G1`, round: name })], {
        rounds: { [name]: theirRound!.id },
      }),
    ).rejects.toThrow()

    await db.delete(rounds).where(eq(rounds.id, theirRound!.id))
    await db.delete(clients).where(eq(clients.id, stranger!.id))
  })
})

describe('what the workbook says is what Finance reports', () => {
  it('reconciles paid and outstanding against the rows it wrote', async () => {
    const ref = `${MARKER}-H1`
    const name = `Reconcile ${MARKER}`
    const result = await commit(
      [
        grantRow({
          reference: ref,
          round: name,
          status: 'active',
          amountAwarded: 30_000,
          amountPaid: 10_000,
          endDate: null,
        }),
      ],
      {
        payments: [
          { reference: ref, dueDate: '2026-01-31', amount: 10_000, paid: true },
          { reference: ref, dueDate: '2027-01-31', amount: 20_000, paid: false },
        ],
      },
    )
    expect(result.reconciliation.totalCommitted).toBe(30_000)
    expect(result.reconciliation.totalPaid).toBe(10_000)
    expect(result.reconciliation.totalOutstanding).toBe(20_000)

    // The same three figures as the finance screen counts them, over this grant alone.
    const pairs = await getDb()
      .select({ id: roundProgrammes.id })
      .from(roundProgrammes)
      .innerJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
      .where(and(eq(rounds.clientId, fx.clientId), eq(rounds.name, name)))
    const scope = pairs.map((p) => p.id)

    const toPay = await financeList(getDb(), scope, { tab: 'to_pay' })
    const paid = await financeList(getDb(), scope, { tab: 'paid' })
    const owed = toPay.items.reduce((n, g) => n + (g.amount ?? 0), 0)
    const settled = paid.items.reduce((n, g) => n + (g.amount ?? 0), 0)
    expect(owed).toBe(20_000)
    expect(settled).toBe(10_000)
  })
})

describe('the review step and the commit agree', () => {
  it('counts the same replacements the commit performs', async () => {
    const ref = `${MARKER}-I1`
    const name = `Agreement ${MARKER}`
    await commit([grantRow({ reference: ref, round: name })])

    const grants = [grantRow({ reference: ref, round: name, amountAwarded: 9_000 })]
    const prepared = await prepareImport({
      data: { grants, payments: [], reports: [], cellIssues: [] },
    })
    // The review screen tells a foundation how many of its grants this upload will
    // overwrite. If that count and the commit's ever disagree, the screen is lying
    // about a destructive act, so they are asserted against each other.
    const result = await commit(grants, { rounds: { [name]: null } })
    expect(prepared.replacing).toBe(1)
    expect(result.replaced).toBe(prepared.replacing)
  })
})

/**
 * The measured ceiling, asserted rather than assumed.
 *
 * Every row of an import is written in ONE `db.batch`: one round trip to Neon under a
 * hard 4-second timeout, and a single statement may carry at most 65,535 bound
 * parameters. Both limits were found here rather than in production. Against staging:
 * 3,500 grants took 3.3s, 5,000 timed out, and before the inserts were chunked anything
 * over ~3,400 failed with "too many query parameters" because one `applications` row
 * spends about nineteen of them.
 *
 * `MAX_GRANTS_PER_IMPORT` is set at 2,000 with that headroom in hand. This test is what
 * keeps the number honest: widen the applications table or add an insert, and it fails
 * here instead of at a foundation's desk, at the end of an upload they have already
 * spent twenty minutes matching.
 */
describe('the supported ceiling', () => {
  it('commits a full-size workbook well inside the database timeout', { timeout: 120_000 }, async () => {
    const name = `Ceiling ${MARKER}`
    const big = Array.from({ length: MAX_GRANTS_PER_IMPORT }, (_, i) =>
      grantRow({ reference: `${MARKER}-K${i}`, round: name }),
    )
    const started = Date.now()
    const result = await commit(big)
    const elapsed = Date.now() - started
    expect(result.grants).toBe(MAX_GRANTS_PER_IMPORT)
    // Not a benchmark: a guard on the one number that decides whether the write
    // completes at all. Comfortably under 4s on a laptop, and a Worker is closer to
    // Neon than a laptop is.
    expect(elapsed).toBeLessThan(3_500)
  })
})

// Keeps the queue mock honest: every grant should have asked for a geocode and a
// screening, and nothing should have been run inline.
describe('derived features', () => {
  // ONE message, whatever the size of the workbook: a full-size import's 4,000 messages
  // are 40 `sendBatch` calls, which does not fit beside the commit's own queries inside
  // one 50-subrequest invocation. The fan-out runs in a consumer instead.
  it('queues one fan-out message, not two per grant', async () => {
    const before = queued.length
    const result = await commit([
      grantRow({ reference: `${MARKER}-J1`, round: `Queue ${MARKER}` }),
      grantRow({ reference: `${MARKER}-J2`, round: `Queue ${MARKER}` }),
    ])
    const sent = queued.slice(before) as Array<{ kind: string; batchId?: string }>
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({ kind: 'import_derive', batchId: result.batchId })
  })

  it('fans that message out into a deprivation and a screening per grant', async () => {
    const result = await commit([
      grantRow({ reference: `${MARKER}-J3`, round: `Fan ${MARKER}` }),
      grantRow({ reference: `${MARKER}-J4`, round: `Fan ${MARKER}` }),
    ])
    const before = queued.length
    const fan = await fanOutImportDerivations(result.batchId)
    expect(fan.queued).toBe(4)
    const sent = queued.slice(before) as Array<{ kind: string }>
    expect(sent.filter((m) => m.kind === 'deprivation')).toHaveLength(2)
    expect(sent.filter((m) => m.kind === 'due_diligence')).toHaveLength(2)
  })
})
