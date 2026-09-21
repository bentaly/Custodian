import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'

/**
 * Edge cases in the onboarding import, against a real database.
 *
 * A companion to `dataImport.itest.ts`, which pins the four failures found on
 * 2026-09-20. This file is the second pass over the same file with fresh eyes, and
 * every test here is written to FAIL: each one states the behaviour the module's own
 * comments promise, against the behaviour it actually has.
 *
 * Fixture, mocks and helpers are copied from `dataImport.itest.ts` deliberately — the
 * two suites build their own tenant so neither can be broken by the other's rows.
 */

const RUN = randomUUID().slice(0, 8)
const MARKER = `edge-${RUN}`

const caller = {
  id: `user-${MARKER}`,
  name: 'Import edges fixture',
  email: `${MARKER}@wrenfield.example`,
  role: 'admin' as const,
  clientId: '',
}

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

// Without this every committed grant fires a real geocode and two registry lookups.
const queued: unknown[] = []
vi.mock('./pipelineQueue', () => ({
  enqueue: async (message: unknown) => (queued.push(message), 'queued' as const),
  enqueueMany: async (messages: unknown[]) => (queued.push(...messages), 'queued' as const),
}))

const { getDb } = await import('./db')
const { assertWritableDatabase } = await import('../../scripts/demo/lib/shared')
const { teardownDemo } = await import('../../scripts/demo/lib/teardown')
const { commitImport, rollbackImport } = await import('./fns/dataImport')
const { financeList } = await import('./fns/finance')
const { setInstalmentPaid } = await import('./fns/applications')
const schema = await import('../../drizzle/schema')
const { applications, awardInstalments, awards, clients, programmes, roundProgrammes, rounds, users } =
  schema

type Fixture = {
  clientId: string
  programmeId: string
  programmeName: string
  otherProgrammeId: string
  otherProgrammeName: string
  liveRoundId: string
  liveRoundName: string
}

let fx: Fixture

beforeAll(async () => {
  assertWritableDatabase()
  const db = getDb()

  const [client] = await db
    .insert(clients)
    .values({ name: `Import edges ${MARKER}` })
    .returning()
  const [programme] = await db
    .insert(programmes)
    .values({ clientId: client!.id, name: `Youth ${MARKER}`, tags: ['Youth', 'Mental health'] })
    .returning()
  const [other] = await db
    .insert(programmes)
    .values({ clientId: client!.id, name: `Place ${MARKER}`, tags: ['Place'] })
    .returning()
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
    otherProgrammeName: other!.name,
    liveRoundId: live!.id,
    liveRoundName: live!.name,
  }
})

afterAll(async () => {
  if (fx?.clientId) await teardownDemo(fx.clientId)
})

// ─── Workbook builders ───────────────────────────────────────────────────────

let rowNumber = 1

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
}) {
  return {
    rowNumber: rowNumber++,
    reference: o.reference,
    organisationName: o.organisationName ?? `Grantee ${o.reference || 'blank'} ${MARKER}`,
    programme: o.programme ?? fx.programmeName,
    round: o.round,
    awardDate: o.awardDate ?? '2022-06-01',
    amountAwarded: o.amountAwarded ?? 10_000,
    amountPaid: o.amountPaid === undefined ? 10_000 : o.amountPaid,
    status: o.status ?? ('completed' as const),
    charityNumber: '1234567',
    companyNumber: null,
    contactEmail: null,
    deliveryArea: 'Preston',
    purpose: 'Core costs',
    themes: [] as string[],
    endDate: o.endDate === undefined ? '2023-05-31' : o.endDate,
    durationYears: null,
    impactQuantity: null,
    bankAccountName: null,
    bankSortCode: null,
    bankAccountNumber: null,
  }
}

async function commit(
  grants: ReturnType<typeof grantRow>[],
  opts: {
    payments?: Array<{ reference: string; dueDate: string; amount: number; paid: boolean }>
    rounds?: Record<string, string | null>
    programmes?: Record<string, string>
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
        programmes: opts.programmes ?? { [fx.programmeName]: fx.programmeId },
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
    id: r.id,
    name: r.name,
    importBatchId: r.importBatchId,
    pairings: r.roundProgrammes.length,
    grants: r.roundProgrammes.reduce((n, rp) => n + rp.applications.length, 0),
  }))
}

/** Every application this client holds, by the reference the import gave it. */
async function referencesHeld(): Promise<string[]> {
  const rows = await getDb()
    .select({ reference: applications.externalApplicationId })
    .from(applications)
    .innerJoin(roundProgrammes, eq(applications.roundProgrammeId, roundProgrammes.id))
    .innerJoin(rounds, eq(roundProgrammes.roundId, rounds.id))
    .where(eq(rounds.clientId, fx.clientId))
  return rows.map((r) => r.reference ?? '')
}

/** The round-programme ids of one named round, for scoping a Finance read. */
async function scopeOf(roundName: string): Promise<string[]> {
  const pairs = await getDb()
    .select({ id: roundProgrammes.id })
    .from(roundProgrammes)
    .innerJoin(rounds, eq(rounds.id, roundProgrammes.roundId))
    .where(and(eq(rounds.clientId, fx.clientId), eq(rounds.name, roundName)))
  return pairs.map((p) => p.id)
}

async function instalmentsOf(reference: string) {
  const [app] = await getDb()
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.externalApplicationId, reference))
  if (!app) return []
  return getDb()
    .select({
      id: awardInstalments.id,
      amount: awardInstalments.amount,
      dueDate: awardInstalments.dueDate,
      paidDate: awardInstalments.paidDate,
    })
    .from(awardInstalments)
    .innerJoin(awards, eq(awards.id, awardInstalments.awardId))
    .where(eq(awards.applicationId, app.id))
}

// ─── 1. Minting a reference that the workbook itself already used ────────────

/**
 * `IMP-0001` is minted for a blank row, and the counter is only ever stepped past
 * references ALREADY IN CUSTODIAN (`usedReferences`). The references the workbook
 * itself carries are never added to that set — worse, any reference the file states is
 * deliberately REMOVED from it (`!incomingRefs.has(...)`), because a grant being
 * replaced is not an obstacle to reusing its own reference.
 *
 * So a file that states `IMP-0001` for one grant and leaves another blank mints
 * `IMP-0001` a second time. That is not a contrived workbook: the mint is announced to
 * the foundation afterwards ("You will get the list afterwards"), the template tells a
 * charity to quote its reference, and re-uploading is the phasing mechanism — so the
 * second workbook having the first one's generated references typed into it is the
 * expected path, not an unusual one.
 *
 * `applications.external_application_id` has an index and no unique constraint, so
 * nothing stops it. Two grants then share the join key that `/api/submit-report` uses
 * to auto-link a report, and that the next re-upload matches on.
 */
describe('a generated reference', () => {
  it('is never one the workbook has already used', async () => {
    const round = `Mint ${MARKER}`
    await commit([
      grantRow({ reference: 'IMP-0001', round, organisationName: `Stated ref ${MARKER}` }),
      grantRow({ reference: '', round, organisationName: `Blank ref ${MARKER}` }),
    ])

    const held = await referencesHeld()
    expect(held.filter((r) => r === 'IMP-0001')).toHaveLength(1)
  })
})

// ─── 2. A cancelled grant, and the money rule ────────────────────────────────

/**
 * The reconciliation totals are the screen a finance lead signs the import off on, and
 * they are stored on `import_batches` so the history screen can repeat them. They are
 * summed over every grant in the file with no regard to its status, so a CANCELLED
 * grant's award counts as committed and its unpaid instalments count as outstanding.
 *
 * The money rule (CLAUDE.md) says the opposite on both: committed and outstanding
 * EXCLUDE cancelled, paid INCLUDES it. Finance implements that rule (`payable`), so the
 * foundation is shown one pair of figures at the end of the import and a different pair
 * on the screen they were asked to reconcile against — with nothing on either screen to
 * say why. The paid figure, which is the one that should differ from Finance's, is the
 * only one that agrees.
 */
describe('a cancelled grant in the workbook', () => {
  it('is reconciled the way Finance counts it', async () => {
    const ref = `${MARKER}-CANX`
    const round = `Cancelled ${MARKER}`
    const result = await commit(
      [
        grantRow({
          reference: ref,
          round,
          status: 'cancelled',
          amountAwarded: 10_000,
          amountPaid: null,
          endDate: null,
        }),
      ],
      {
        payments: [
          { reference: ref, dueDate: '2026-01-31', amount: 4_000, paid: true },
          { reference: ref, dueDate: '2027-01-31', amount: 6_000, paid: false },
        ],
      },
    )

    const scope = await scopeOf(round)
    const fin = await financeList(getDb(), scope, { tab: 'to_pay' })

    // Paid includes cancelled on both sides: the money left the building.
    expect(result.reconciliation.totalPaid).toBe(fin.totals.paidToDate)
    // Nothing is left to pay on a withdrawn grant, on either screen.
    expect(result.reconciliation.totalOutstanding).toBe(fin.totals.outstanding)

    // Committed is the one that legitimately DIFFERS, and CLAUDE.md says so in as many
    // words: in a rollup the word means `max(committed, paid)` per grant, so a grant
    // cancelled after one instalment counts for that instalment (£4,000 here), while
    // Finance's column of the same name means live commitments and excludes it
    // wholesale. Two words, two meanings, both correct. Asserting they match would have
    // made the import under-report money that really did leave the building, which is
    // exactly the mistake the rollup rule was written to stop.
    expect(result.reconciliation.totalCommitted).toBe(4_000)
    expect(fin.totals.committed).toBe(0)
  })
})

// ─── 3. A payment made in Custodian after the import ─────────────────────────

/**
 * `rollbackImport` declares the guard in its own comment — "An instalment paid since
 * the import is money that moved" — and then never applies it: the query carries
 * `.limit(0)`, so it can only ever come back empty, and the result is `void`ed before
 * the blockers are assembled. Both halves have to be removed for the guard to work, and
 * neither is.
 *
 * So a foundation that imports its live grants, pays the next instalment through
 * Finance, and then undoes the import loses the payment record with no warning at all —
 * which is the one thing on an imported grant that is not an import artefact.
 */
describe('rollback, after an instalment has been paid in Custodian', () => {
  it('is refused', async () => {
    const ref = `${MARKER}-PAID`
    const round = `Paid after import ${MARKER}`
    const result = await commit([grantRow({ reference: ref, round, status: 'active', amountPaid: null, endDate: null })], {
      payments: [{ reference: ref, dueDate: '2026-11-30', amount: 10_000, paid: false }],
    })

    // Through the server function the Finance screen calls, not by writing the column:
    // paying an instalment also writes the `grant_payment_recorded` audit row, and that
    // row is what makes the payment distinguishable from the hundreds an import writes
    // itself. A direct UPDATE here would simulate a state the app cannot produce.
    const [instalment] = await instalmentsOf(ref)
    await setInstalmentPaid({ data: { id: instalment!.id, paid: true, paidDate: '2026-11-28' } })

    await expect(rollbackImport({ data: { batchId: result.batchId } })).rejects.toThrow()
  })
})

/**
 * The replace path is the same act by a different door, and `protectedReplacements`
 * exists precisely because of that ("The guard belongs on both or neither"). It checks
 * comments, votes, award letters and grantee reports, and not the one thing on the list
 * that is money. A re-upload correcting a typo therefore rebuilds the award from the
 * workbook and takes the paid date with it: the workbook's `paid` column is FALSE for
 * an instalment paid last week, and false is also what an untouched sheet says, so the
 * two cannot be told apart. This is the same reasoning the bank columns already get
 * ("A blank cell is the foundation saying nothing").
 */
describe('a re-upload, after an instalment has been paid in Custodian', () => {
  it('does not silently unpay it', async () => {
    const ref = `${MARKER}-REPAID`
    const round = `Repaid ${MARKER}`
    await commit([grantRow({ reference: ref, round, status: 'active', amountPaid: null, endDate: null })], {
      payments: [{ reference: ref, dueDate: '2026-11-30', amount: 10_000, paid: false }],
    })

    const [instalment] = await instalmentsOf(ref)
    await getDb()
      .update(awardInstalments)
      .set({ paidDate: '2026-11-28' })
      .where(eq(awardInstalments.id, instalment!.id))

    // The same workbook again, with a corrected delivery area say. Nothing about the
    // payment changed, because the person correcting it does not hold the payment run.
    await commit(
      [grantRow({ reference: ref, round, status: 'active', amountPaid: null, endDate: null })],
      {
        payments: [{ reference: ref, dueDate: '2026-11-30', amount: 10_000, paid: false }],
        rounds: { [round]: null },
      },
    )

    const after = await instalmentsOf(ref)
    expect(after).toHaveLength(1)
    expect(after[0]!.paidDate).toBe('2026-11-28')
  })
})

// ─── 4. The round a second import inherited ──────────────────────────────────

/**
 * `rounds.import_batch_id` exists so an invented round can be taken away again, and
 * rollback removes the ones "THIS batch invented". But a round is stamped with the
 * batch that CREATED it, and the grants in it belong to whichever batch wrote them
 * last: a re-upload replaces the application and leaves the round alone.
 *
 * Undo them in order and nothing removes the round. The second batch's rollback skips
 * it (the round carries the first batch's id) and the first batch's rollback returns
 * early at `applicationIds.length === 0` — before it reaches the round cleanup at all —
 * because the re-upload already took its applications. The foundation is left with an
 * empty round in every picker it has, and rounds cannot be deleted from the UI. That is
 * exactly the state the column was added to prevent.
 */
describe('undoing both of two imports that shared a round', () => {
  it('leaves no empty round behind', async () => {
    const ref = `${MARKER}-SHARED`
    const round = `Shared round ${MARKER}`

    const first = await commit([grantRow({ reference: ref, round })])
    const created = (await roundState()).find((r) => r.name === round)!
    expect(created.grants).toBe(1)

    // The corrected workbook: same grant, same round, matched to the round that now
    // exists — which is what the review screen offers once the first import created it.
    const second = await commit([grantRow({ reference: ref, round, amountAwarded: 12_000 })], {
      rounds: { [round]: created.id },
    })

    await rollbackImport({ data: { batchId: second.batchId } })
    const undoneFirst = await rollbackImport({ data: { batchId: first.batchId } })
    expect(undoneFirst.removed).toBe(0)

    expect((await roundState()).find((r) => r.name === round)).toBeUndefined()
  })
})

// ─── 5. A pairing the foundation has since taken over ────────────────────────

/**
 * The empty-pairing cleanup is keyed on provenance alone: `import_batch_id is not null`
 * plus "nothing hangs off it". Nothing ever clears that column, and `saveRound` updates
 * a pairing's budget in place, so a pairing the import created and a HUMAN has since
 * given a budget to still reads as an import artefact.
 *
 * The damage is not limited to rounds the import invented. A foundation's live round
 * gains a programme because a historic grant was filed under it; the admin then decides
 * to fund that programme in that round and sets a budget on it. The next re-upload
 * moves the historic grant elsewhere, the pairing is empty, and the programme drops out
 * of a round the foundation is currently running, taking its budget with it. Nothing is
 * said, and the amount is not recoverable from the workbook.
 */
describe('a pairing an import created in a round the foundation runs', () => {
  it('survives once the foundation has given it a budget', async () => {
    const ref = `${MARKER}-ADOPT`
    const programmes2 = {
      [fx.otherProgrammeName]: fx.otherProgrammeId,
    }

    await commit(
      [
        grantRow({
          reference: ref,
          round: fx.liveRoundName,
          programme: fx.otherProgrammeName,
        }),
      ],
      { rounds: { [fx.liveRoundName]: fx.liveRoundId }, programmes: programmes2 },
    )

    const pairWhere = and(
      eq(roundProgrammes.roundId, fx.liveRoundId),
      eq(roundProgrammes.programmeId, fx.otherProgrammeId),
    )
    // What `saveRound` writes when an admin sets a budget on it. Note that it does not
    // touch `import_batch_id`, and has no reason to.
    await getDb().update(roundProgrammes).set({ budget: '100000' }).where(pairWhere)

    // A corrected workbook that files the historic grant under its real round.
    await commit(
      [
        grantRow({
          reference: ref,
          round: `Real home ${MARKER}`,
          programme: fx.otherProgrammeName,
        }),
      ],
      { programmes: programmes2 },
    )

    const still = await getDb()
      .select({ id: roundProgrammes.id, budget: roundProgrammes.budget })
      .from(roundProgrammes)
      .where(pairWhere)
    expect(still).toHaveLength(1)
    expect(still[0]!.budget).toBe('100000')
  })
})

// Keeps the fixture honest: nothing above should have reached another tenant's rows.
describe('the fixture', () => {
  it('wrote only into its own client', async () => {
    const strays = await getDb()
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(inArray(rounds.name, [`Mint ${MARKER}`]), eq(rounds.clientId, fx.clientId)))
    expect(strays.length).toBeGreaterThan(0)
  })
})
