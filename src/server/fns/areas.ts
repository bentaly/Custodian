// The places the deprivation lookup can report on BY NAME, for the delivery area's
// autocomplete: every district (local authority), county (police force area, which is
// what the lookup reports a county as) and English region in `deprivation_areas`.
//
// About 420 names, so the whole list is sent once and filtered in the browser as the
// person types: no query per keystroke. Cached for the life of the isolate, since the
// table only changes when somebody re-seeds it.
//
// Suggestions only. The field stays free text, because a town or neighbourhood inside a
// district ("Birkenhead") is a better answer than the district when it is known, and
// the geocoder reads those; this list is the set of names that are certain to resolve.

import { createServerFn } from '@tanstack/react-start'
import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import { deprivationAreas } from '../../../drizzle/schema'
import { requireAuthUser } from '../session'

export type AreaKind = 'District' | 'County' | 'Region'
export type AreaName = { name: string; kind: AreaKind }

let cached: Promise<AreaName[]> | null = null

async function load(): Promise<AreaName[]> {
  const rows = await getDb()
    .select({
      lad: deprivationAreas.ladName,
      pfa: deprivationAreas.pfaName,
      region: deprivationAreas.regionName,
    })
    .from(deprivationAreas)
    .groupBy(deprivationAreas.ladName, deprivationAreas.pfaName, deprivationAreas.regionName)
    .orderBy(sql`1`)
  const seen = new Map<string, AreaName>()
  const add = (name: string | null, kind: AreaKind) => {
    const n = name?.trim()
    // A district and a county can share a name (a unitary authority that is its own
    // force area); the district is the sharper answer, so it keeps the entry.
    if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), { name: n, kind })
  }
  for (const r of rows) add(r.lad, 'District')
  for (const r of rows) add(r.pfa, 'County')
  for (const r of rows) add(r.region, 'Region')
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const listAreaNames = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuthUser()
  cached ??= load().catch((err) => {
    cached = null
    throw err
  })
  return cached
})
