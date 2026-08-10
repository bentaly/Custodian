import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { neonConfig } from '@neondatabase/serverless'

// The retry rule is the safety-critical half of the query wrapper. A read that is
// wrongly classed as a write merely fails where it could have recovered; a WRITE
// wrongly classed as a read gets sent twice, and a second `insert into awards` is a
// duplicate grant. So "read-only" has to be proven, and everything else — including
// anything unparseable — must fall to the safe side.
process.env['DATABASE_URL'] = 'postgresql://user:pass@ep-test.eu-west-2.aws.neon.tech/db'

const { getDb, databaseTimeout } = await import('./db')

type QueryFetch = (url: string, init: RequestInit) => Promise<Response>

/** `getDb()` installs the wrapper on the global neon config; take it back out again so
 *  the test exercises the same function production does, wiring included. */
function installedFetch(): QueryFetch {
  getDb()
  return neonConfig.fetchFunction as QueryFetch
}

const body = (sql: string) => JSON.stringify({ query: sql, params: [] })
const batchBody = (...sql: string[]) =>
  JSON.stringify({ queries: sql.map((q) => ({ query: q, params: [] })) })

const ok = () => new Response('{}', { status: 200 })
const dead = () => Promise.reject(new Error('The operation was aborted due to timeout'))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('query retries', () => {
  it('retries a read once, on a fresh connection', async () => {
    fetchMock.mockImplementationOnce(dead).mockImplementationOnce(async () => ok())

    const response = await installedFetch()('https://neon/sql', {
      body: body('select "id" from "programmes"'),
    })

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up after one retry rather than hanging on', async () => {
    fetchMock.mockImplementation(dead)

    await expect(
      installedFetch()('https://neon/sql', { body: body('select 1') }),
    ).rejects.toMatchObject({ name: 'DatabaseTimeout', isWrite: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never retries a write — it may already have committed', async () => {
    fetchMock.mockImplementation(dead)

    await expect(
      installedFetch()('https://neon/sql', {
        body: body('insert into "programmes" ("name") values ($1) returning *'),
      }),
    ).rejects.toMatchObject({ name: 'DatabaseTimeout', isWrite: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a batch only when every statement in it reads', async () => {
    fetchMock.mockImplementation(dead)
    const send = installedFetch()

    await expect(
      send('https://neon/sql', { body: batchBody('select 1', 'select 2') }),
    ).rejects.toMatchObject({ isWrite: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    await expect(
      send('https://neon/sql', { body: batchBody('select 1', 'update "awards" set "x" = 1') }),
    ).rejects.toMatchObject({ isWrite: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats an unreadable body as a write', async () => {
    fetchMock.mockImplementation(dead)

    await expect(installedFetch()('https://neon/sql', { body: 'not json' })).rejects.toMatchObject({
      isWrite: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not treat a CTE as a read', async () => {
    // `with … update` writes, and telling it apart from `with … select` is not worth
    // the risk — so a CTE simply forgoes the retry.
    fetchMock.mockImplementation(dead)

    await expect(
      installedFetch()('https://neon/sql', { body: body('with x as (select 1) select * from x') }),
    ).rejects.toMatchObject({ isWrite: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('databaseTimeout', () => {
  it('recognises the error after neon has wrapped it', async () => {
    fetchMock.mockImplementation(dead)

    const raw = await installedFetch()('https://neon/sql', { body: body('select 1') }).catch(
      (e: unknown) => e,
    )
    // neon catches whatever the fetch threw and re-throws its own NeonDbError, keeping
    // the original on `sourceError`. That wrapper is what reaches `toClientError`.
    const wrapped = Object.assign(new Error('Error connecting to database'), { sourceError: raw })

    expect(databaseTimeout(wrapped)).toEqual({ isWrite: false })
  })

  it('ignores errors that are not timeouts', () => {
    expect(databaseTimeout(new Error('duplicate key value'))).toBeNull()
    expect(databaseTimeout(null)).toBeNull()
    expect(databaseTimeout(undefined)).toBeNull()
  })
})
