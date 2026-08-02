// Builds the boundary files the Insights choropleth draws.
//
// Run with `pnpm geo:build`. Output lands in `public/geo/` and is committed —
// this is static reference data that changes when ONS republishes (roughly
// yearly), not something to fetch at runtime. Vite copies `public/` into
// `dist/client`, which is the Worker's [assets] directory, so the files ship as
// plain static assets and never touch the Worker itself.
//
// Three layers, deliberately coarse. Everything is BUC (ultra-generalised,
// 500m, clipped to coastline) or Natural Earth 50m — at panel size that is
// indistinguishable from full resolution and roughly two orders of magnitude
// smaller. Anyone wanting a crisper coastline should step up to BSC (200m)
// rather than reach for BGC/BFC, which are megabytes.
//
//   world.json   — Natural Earth admin-0 countries, keyed ISO A3 ("UKR", "GBR")
//   uk.json      — England's 9 statistical regions + Wales/Scotland/NI, keyed
//                  by the region name we already persist on DeliveryGeo.region
//   uk-lad.json  — all UK local authority districts, keyed ONS LAD code
//                  ("E09000019"). London's 33 boroughs are LADs, so the London
//                  view is a filter on this layer, not a separate file.
//
// Sources (both free to use, attribution required for ONS — see ATTRIBUTION
// below, which is rendered under the map):
//   ONS Open Geography Portal — Open Government Licence v3
//   Natural Earth via topojson/world-atlas — public domain
//
// Licensing note: the ONS files carry Ordnance Survey rights, so the
// attribution string is not optional decoration. It is a condition of the OGL.

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import mapshaper from 'mapshaper'

const OUT = join(process.cwd(), 'public', 'geo')
const TMP = join(process.cwd(), 'node_modules', '.cache', 'geo')

const ONS = 'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services'
// Natural Earth admin-0 as GeoJSON. Deliberately NOT topojson/world-atlas: that
// build keys geometries by numeric M49 id and carries no ISO alpha-3, which is
// the code an application's delivery country would realistically be stored as.
//
// 50m, not 110m. 110m is built for a whole-world view and falls apart the
// moment the map zooms to a single country — Ukraine becomes a blob and
// Bangladesh a jagged mess. 50m survives that zoom; simplified to 25% it costs
// ~72 KB gzipped, which is a fair price for the only file that has to work at
// two very different scales.
const WORLD =
  'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master/50m/cultural/ne_50m_admin_0_countries.json'

// ONS serves ArcGIS FeatureServers. `f=geojson` + `outSR=4326` gets us WGS84
// GeoJSON rather than the British National Grid the layers are stored in —
// d3-geo's projections all expect lon/lat degrees.
function onsUrl(service: string, fields: string) {
  const q = new URLSearchParams({
    where: '1=1',
    outFields: fields,
    outSR: '4326',
    f: 'geojson',
  })
  return `${ONS}/${service}/FeatureServer/0/query?${q}`
}

async function fetchJson(url: string, label: string) {
  process.stdout.write(`  ↓ ${label}… `)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  // ArcGIS reports failures as a 200 with an `error` key, so status alone is
  // not enough to trust the payload.
  const json = JSON.parse(text)
  if (json.error) throw new Error(`${label}: ArcGIS ${json.error.code} ${json.error.message}`)
  console.log(`${(text.length / 1024 / 1024).toFixed(1)} MB`)
  return json
}

async function stage(name: string, data: unknown) {
  const path = join(TMP, name)
  await writeFile(path, JSON.stringify(data))
  return path
}

/** Runs a mapshaper pipeline and writes the named output into public/geo. */
async function run(cmd: string, outName: string) {
  const result = await mapshaper.applyCommands(cmd)
  const file = result[outName]
  if (!file) throw new Error(`mapshaper produced no ${outName} (got ${Object.keys(result)})`)
  await writeFile(join(OUT, outName), file)
  const kb = (Buffer.byteLength(file) / 1024).toFixed(0)
  console.log(`  ✓ ${outName} — ${kb} KB`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  await mkdir(TMP, { recursive: true })

  console.log('\nWorld (Natural Earth admin-0, 50m)')
  const world = await fetchJson(WORLD, 'Natural Earth admin-0 50m')
  const worldPath = await stage('world-raw.json', world)
  await run(
    [
      `-i ${worldPath} name=countries`,
      // Antarctica is a third of the frame and can never hold a grant. Dropping
      // it lets the projection fit the inhabited world instead of centring on
      // an ice shelf.
      `-filter 'NAME != "Antarctica"'`,
      // ISO_A3 is "-99" for a handful of features — France and Norway because
      // Natural Earth models their overseas/mainland split, plus genuinely
      // unrecognised states (Kosovo, N. Cyprus, Somaliland). ISO_A3_EH is the
      // variant that resolves the first case; ADM0_A3 catches the rest so no
      // country ends up unkeyed and silently unpaintable.
      `-each 'code = (ISO_A3_EH && ISO_A3_EH != "-99") ? ISO_A3_EH : ADM0_A3, name = NAME, continent = CONTINENT'`,
      `-filter-fields code,name,continent`,
      // Tuned against the country-zoom view, which is what sets the floor here:
      // below ~25% coastlines start visibly faceting when a single country
      // fills the frame.
      `-simplify 25% keep-shapes`,
      `-clean`,
      `-o world.json format=topojson`,
    ].join(' '),
    'world.json',
  )

  console.log('\nUK regions (ONS Regions Dec 2025 EN BUC + nations)')
  const regions = await fetchJson(
    onsUrl('Regions_December_2025_Boundaries_EN_BUC', 'RGN25CD,RGN25NM'),
    'England regions',
  )
  const lads = await fetchJson(
    onsUrl('LAD_MAY_2025_UK_BUC', 'LAD25CD,LAD25NM'),
    'UK local authority districts',
  )
  const regionsPath = await stage('regions-raw.json', regions)
  const ladsPath = await stage('lads-raw.json', lads)

  // England arrives as its 9 statistical regions. Wales, Scotland and Northern
  // Ireland have no equivalent tier, so we dissolve their LADs into one shape
  // each — ONS LAD codes are prefixed by nation (E/W/S/N), which is what the
  // `nation` expression keys off. The result is the same 12-way split the old
  // tile map used, so `DeliveryGeo.region` keeps joining without a lookup.
  await run(
    [
      `-i ${regionsPath} name=regions`,
      `-each 'code = RGN25CD, name = RGN25NM'`,
      `-filter-fields code,name`,
      `-i ${ladsPath} name=nations`,
      // Only the three non-England nations; England is already covered above.
      `-filter 'LAD25CD.charAt(0) != "E"' target=nations`,
      `-each 'nation = {W:"Wales", S:"Scotland", N:"Northern Ireland"}[LAD25CD.charAt(0)]' target=nations`,
      `-dissolve nation target=nations`,
      `-each 'code = {Wales:"W92000004", Scotland:"S92000003", "Northern Ireland":"N92000002"}[nation], name = nation' target=nations`,
      `-filter-fields code,name target=nations`,
      `-merge-layers target=regions,nations force name=regions`,
      `-simplify 12% keep-shapes`,
      `-clean`,
      `-o uk.json format=topojson`,
    ].join(' '),
    'uk.json',
  )

  console.log('\nUK local authority districts (ONS LAD May 2025 UK BUC)')
  // Each LAD carries the region it sits in, so drilling "London → its boroughs"
  // is a filter on this one layer rather than 12 more files.
  //
  // The region comes from ONS's own LAD→Region lookup, not a spatial join. A
  // spatial join looked tempting and was wrong: at BUC generalisation the Isles
  // of Scilly fall outside the South West's coastline and end up regionless. An
  // authoritative table has no such edge cases and is versioned to match the
  // boundary vintage. The lookup is England-only (no other nation has a region
  // tier), so W/S/NI fall back to the nation name — which is what
  // `DeliveryGeo.region` holds for them anyway.
  const lookup = await fetchJson(
    `${ONS}/LAD25_RGN25_EN_LU_v2/FeatureServer/0/query?` +
      new URLSearchParams({
        where: '1=1',
        outFields: 'LAD25CD,RGN25NM',
        returnGeometry: 'false',
        f: 'json',
      }),
    'LAD → region lookup',
  )
  const rows = (lookup.features as Array<{ attributes: Record<string, string> }>).map(
    (f) => f.attributes,
  )
  const lookupPath = join(TMP, 'lad-region.csv')
  await writeFile(
    lookupPath,
    ['LAD25CD,RGN25NM', ...rows.map((r) => `${r.LAD25CD},"${r.RGN25NM}"`)].join('\n'),
  )

  await run(
    [
      // NB: `-each` with a comma in the expression must not be followed by
      // `target=` on the same command — mapshaper mis-splits it. Set the target
      // as its own command instead.
      `-i ${ladsPath} name=lads`,
      `-join ${lookupPath} keys=LAD25CD,LAD25CD fields=RGN25NM string-fields=LAD25CD`,
      `-each 'code = LAD25CD, name = LAD25NM'`,
      `-each 'region = RGN25NM || {W:"Wales", S:"Scotland", N:"Northern Ireland"}[code.charAt(0)] || null'`,
      `-filter-fields code,name,region`,
      `-simplify 12% keep-shapes`,
      `-clean`,
      `-o uk-lad.json format=topojson target=lads`,
    ].join(' '),
    'uk-lad.json',
  )

  // Record where the bytes came from next to the bytes themselves — a year from
  // now "which vintage is this?" is the first question anyone asks.
  await writeFile(
    join(OUT, 'SOURCES.md'),
    [
      '# Boundary sources',
      '',
      'Generated by `pnpm geo:build` (scripts/build-geo.ts). Do not hand-edit.',
      '',
      `Last built: ${new Date().toISOString().slice(0, 10)}`,
      '',
      '| File | Source | Licence |',
      '| --- | --- | --- |',
      '| `world.json` | Natural Earth admin-0 countries 50m (simplified 25%) | Public domain |',
      '| `uk.json` | ONS Regions (December 2025) EN BUC + LAD (May 2025) UK BUC dissolved to nations | OGL v3 |',
      '| `uk-lad.json` | ONS Local Authority Districts (May 2025) UK BUC | OGL v3 |',
      '',
      '## Required attribution (ONS files)',
      '',
      '> Contains OS data © Crown copyright and database right 2025.',
      '> Source: Office for National Statistics licensed under the Open Government Licence v.3.0.',
      '',
      'This is a licence condition, not a courtesy — it is rendered beneath the map',
      'on the Insights screen. Do not remove it.',
      '',
      '`BUC` = ultra-generalised (500m), clipped to coastline. See the header of',
      'scripts/build-geo.ts for why that resolution and not a finer one.',
      '',
    ].join('\n'),
  )
  console.log('  ✓ SOURCES.md')

  await rm(TMP, { recursive: true, force: true })
  console.log('\nDone.\n')
}

main().catch((err) => {
  console.error('\nbuild-geo failed:', err.message)
  process.exit(1)
})
