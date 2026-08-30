import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { assertWritableDatabase } from '../../scripts/demo/lib/shared'
import { teardownDemo } from '../../scripts/demo/lib/teardown'
import { financeList } from './fns/finance'
import { awardsList } from './fns/applications'
import { reportsList } from './fns/reports'
import { insightsData } from './fns/insights'
import { dashboardData } from './fns/dashboard'
import { searchData } from './fns/search'
import { shortlistData } from './fns/shortlist'
import { awardCandidatesData } from './fns/awardSetup'
import { addDaysIso, todayIso } from '../lib/schedule'
import {
  applicationVotes,
  applications,
  awardInstalments,
  awards,
  clients,
  programmes,
  reportSchedule,
  roundProgrammes,
  rounds,
  users,
} from '../../drizzle/schema'

/**
 * One foundation must never see another's rows — asserted against a real database,
 * on the rows that actually come back.
 *
 * ## Why this suite exists
 *
 * On 2026-08-30 the Finance list showed three of another foundation's grants to a
 * Wrenfield admin. The tenant scope was not missing: `visibleRoundProgrammeIds`
 * returned the right ids and `inArray(applications.roundProgrammeId, scope)` was in the
 * `and()`. The cancelled-grant rule beside it was a raw template carrying a bare `or`,
 * and because `and()` brackets the list but not each member, Postgres re-associated the
 * clause and left the scope governing one branch of an OR.
 *
 * Every cheaper defence would have passed it. "Did the fn call `visibleRoundProgrammeIds`?"
 * — yes. "Do the scope ids appear in the emitted SQL?" — yes, on the wrong side of an
 * OR. Only looking at returned rows catches a mistake in how the predicate composes,
 * which is why this suite runs queries instead of inspecting them.
 *
 * ## The shape
 *
 * Two complete tenants, both populated, are built per run and torn down after. Every
 * string in a tenant carries a marker unique to that tenant and that run, so the
 * assertion can be made against the WHOLE serialised response rather than a hand-picked
 * field: a leak in a facet — another foundation's programme names in a filter pill — is
 * as real as a leak in a row, and enumerating fields would miss it.
 *
 * Each entry asserts three things, and the positive control is not optional: without
 * `toContain(own marker)`, a function that returns nothing at all would pass forever.
 */

/** Distinguishes concurrent runs, so two people running this at once cannot collide. */
const RUN = randomUUID().slice(0, 8)

/** Everything a list function needs to be called as somebody. */
type Caller = {
  /** Round-programme ids, the currency Finance and Awards scope in. `null` = superadmin. */
  scope: string[] | null
  /** The currency Reports scopes in. `null` for a superadmin, who has no client. */
  clientId: string | null
}

type Tenant = Caller & {
  /** Appears in every string this tenant owns; nothing else in the database contains it. */
  marker: string
  clientId: string
  scope: string[]
}

async function makeTenant(label: string): Promise<Tenant> {
  const db = getDb()
  const marker = `tnc-${RUN}-${label}`

  const [client] = await db
    .insert(clients)
    .values({ name: `Tenancy fixture ${marker}` })
    .returning()
  const [programme] = await db
    .insert(programmes)
    .values({ clientId: client!.id, name: `Programme ${marker}` })
    .returning()
  const [round] = await db
    .insert(rounds)
    .values({ clientId: client!.id, name: `Round ${marker}` })
    .returning()
  const [rp] = await db
    .insert(roundProgrammes)
    .values({ roundId: round!.id, programmeId: programme!.id, budget: '100000' })
    .returning()

  // Two grants, because the Finance tabs partition the population: one settled in full
  // lands on **Paid**, one part-paid lands on **To pay**. A tenant with only one grant
  // would leave a tab empty, and an empty tab cannot carry a positive control.
  async function grant(suffix: string, settled: boolean) {
    const [application] = await db
      .insert(applications)
      .values({
        roundProgrammeId: rp!.id,
        organisationName: `Grantee ${suffix} ${marker}`,
        amountRequested: '50000',
        status: 'awarded',
      })
      .returning()
    const [award] = await db
      .insert(awards)
      .values({ applicationId: application!.id, clientId: client!.id, amountAwarded: '50000' })
      .returning()
    await db.insert(awardInstalments).values([
      {
        awardId: award!.id,
        instalmentNo: 1,
        amount: '25000',
        dueDate: addDaysIso(todayIso(), -60),
        paidDate: addDaysIso(todayIso(), -55),
      },
      {
        awardId: award!.id,
        instalmentNo: 2,
        amount: '25000',
        dueDate: addDaysIso(todayIso(), settled ? -30 : 45),
        paidDate: settled ? addDaysIso(todayIso(), -25) : null,
      },
    ])
    return award!
  }

  await grant('settled', true)
  const open = await grant('open', false)

  // Shortlist and the award-setup queue list SHORTLISTED applications, and the queue
  // additionally requires a trustee majority — so the tenant needs one trustee and one
  // yes vote, or both screens return nothing and their positive control cannot hold.
  const [candidate] = await db
    .insert(applications)
    .values({
      roundProgrammeId: rp!.id,
      organisationName: `Candidate ${marker}`,
      amountRequested: '30000',
      status: 'shortlisted',
    })
    .returning()
  const [trustee] = await db
    .insert(users)
    .values({
      id: `user-${marker}`,
      clientId: client!.id,
      name: `Trustee ${marker}`,
      // `.example` is RFC 2606 reserved, so a fixture address can never receive mail.
      email: `${marker}@tenancy.example`,
      role: 'trustee',
    })
    .returning()
  // One trustee, one yes: `yes * 2 > trustees` carries it.
  await db
    .insert(applicationVotes)
    .values({ applicationId: candidate!.id, userId: trustee!.id, vote: 'yes' })

  // Gives the Reports screen's "awaiting" tab something to list: a milestone due and
  // not yet submitted.
  await db.insert(reportSchedule).values({
    awardId: open.id,
    label: `Annual report ${marker}`,
    dueDate: addDaysIso(todayIso(), 30),
  })

  return { marker, clientId: client!.id, scope: [rp!.id] }
}

/**
 * A list function as the test drives it: given a caller, hand back whatever the screen
 * would receive.
 *
 * The three take their tenant in three different currencies — Finance `string[] | null`,
 * Awards `string[] | undefined`, Reports a bare `clientId` — which is itself worth
 * noticing. Translating here keeps that inconsistency in one visible place instead of
 * spread through the assertions.
 */
type ListUnderTest = {
  name: string
  run: (caller: Caller) => Promise<unknown>
  /** False where the function has no superadmin mode at all — see Reports below. */
  unrestricted: boolean
}

const LISTS: ListUnderTest[] = [
  {
    name: 'finance · to pay',
    run: (c) => financeList(getDb(), c.scope, { tab: 'to_pay' }),
    unrestricted: true,
  },
  {
    name: 'finance · paid',
    run: (c) => financeList(getDb(), c.scope, { tab: 'paid' }),
    unrestricted: true,
  },
  {
    name: 'awards',
    // `awardsList` spells "unrestricted" as `undefined` where Finance spells it `null`.
    run: (c) => awardsList(getDb(), c.scope ?? undefined, {}),
    unrestricted: true,
  },
  {
    name: 'insights',
    run: (c) => insightsData(getDb(), c.scope),
    unrestricted: true,
  },
  {
    name: 'shortlist',
    run: (c) => shortlistData(getDb(), c.scope ?? undefined, c.clientId),
    unrestricted: true,
  },
  {
    name: 'award setup queue',
    run: (c) => awardCandidatesData(getDb(), c.scope ?? undefined),
    unrestricted: true,
  },
  {
    name: 'dashboard',
    // Needs a caller, not just a tenant: the greeting, the role the screen adapts to
    // and "awaiting my vote" are all about the person.
    run: (c) =>
      dashboardData(getDb(), c.scope, {
        id: `user-${c.clientId ?? 'super'}`,
        name: 'Tenancy fixture',
        role: c.clientId ? 'admin' : 'superadmin',
        clientId: c.clientId,
      }),
    unrestricted: true,
  },
  {
    name: 'global search',
    // Searched on the term BOTH tenants share, so the query cannot do the filtering for
    // the scope. Searching each tenant's own marker would pass even with no scope at all.
    run: (c) => searchData(getDb(), c.scope, c.clientId, `tnc-${RUN}`),
    unrestricted: true,
  },
  {
    name: 'reports · awaiting',
    // Scoped by `clientId`, not by round-programme. `listReports` returns an empty list
    // for a caller with no client, so a superadmin sees nothing here rather than
    // everything — there is no unrestricted mode to assert.
    run: (c) => reportsList(getDb(), c.clientId!, { tab: 'awaiting' }),
    unrestricted: false,
  },
]

let A: Tenant
let B: Tenant

beforeAll(async () => {
  // Refuses the production connection string. Beyond that guard, teardown only ever
  // deletes the two client ids created below, so a run pointed somewhere unexpected
  // cannot remove data it did not write.
  assertWritableDatabase()
  A = await makeTenant('a')
  B = await makeTenant('b')
})

afterAll(async () => {
  // `teardownDemo` is the audited deletion order for one tenant — hand-ordered because
  // two foreign keys are RESTRICT and a cascade from `clients` walks into them. Reused
  // rather than reimplemented so there is one such list in the repo, not two.
  // `teardownDemo` DETACHES users it did not create (sets `client_id` to null) rather
  // than deleting them, which is right for a real person signing in with Google and
  // wrong for a fixture row — it would leave an orphan user behind on every run. So the
  // fixture's own users go explicitly, after the tenant they belonged to.
  for (const t of [A, B]) {
    if (!t) continue
    await teardownDemo(t.clientId)
    await getDb().delete(users).where(eq(users.id, `user-${t.marker}`))
  }
})

describe('tenant isolation', () => {
  for (const list of LISTS) {
    it(`${list.name} — returns tenant A's rows and none of tenant B's`, async () => {
      const payload = JSON.stringify(await list.run(A))
      // Positive control: without this, a function returning nothing passes forever.
      expect(payload).toContain(A.marker)
      expect(payload).not.toContain(B.marker)
    })

    it(`${list.name} — and the same holds with the tenants swapped`, async () => {
      const payload = JSON.stringify(await list.run(B))
      expect(payload).toContain(B.marker)
      expect(payload).not.toContain(A.marker)
    })

    if (list.unrestricted) {
      it(`${list.name} — a superadmin sees both`, async () => {
        const payload = JSON.stringify(await list.run({ scope: null, clientId: null }))
        expect(payload).toContain(A.marker)
        expect(payload).toContain(B.marker)
      })
    }
  }
})

/**
 * The registry rots silently if a new screen is added and nobody adds a line to
 * `LISTS`, which is exactly how the Finance leak went unnoticed. This reads the source
 * and fails when a server fn resolves a tenant scope without being represented here.
 *
 * It asserts on FILES rather than functions because that is what can be checked without
 * a running session, and it is deliberately a reminder rather than a proof: a file
 * being covered does not mean every list in it is. Update both when you add a screen.
 */
describe('coverage', () => {
  it('every module that resolves a tenant scope is represented in LISTS', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')

    const dir = join(import.meta.dirname, 'fns')
    const scoped: string[] = []
    for (const file of await readdir(dir)) {
      if (!file.endsWith('.ts')) continue
      const source = await readFile(join(dir, file), 'utf8')
      if (/visibleRoundProgrammeIds\(/.test(source)) scoped.push(file)
    }

    // Every module that resolves a tenant scope now exposes a `(db, scope, …)` function
    // and has an entry in `LISTS` above. There is deliberately no "not yet covered"
    // escape list: the moment one is needed, the exemption should be argued for in a
    // comment here rather than added silently.
    const COVERED = [
      'applications.ts', // awardsList
      'awardSetup.ts', // awardCandidatesData
      'dashboard.ts', // dashboardData
      'finance.ts', // financeList
      'insights.ts', // insightsData
      'search.ts', // searchData
      'shortlist.ts', // shortlistData
    ]

    const unaccounted = scoped.filter((f) => !COVERED.includes(f))
    expect(unaccounted, 'new module resolves a tenant scope — add it to LISTS').toEqual([])

    // And the reverse: a module listed here that no longer scopes anything is a stale
    // entry hiding the fact that coverage moved.
    const stale = COVERED.filter((f) => !scoped.includes(f))
    expect(stale, 'listed as covered but no longer resolves a scope').toEqual([])
  })
})
