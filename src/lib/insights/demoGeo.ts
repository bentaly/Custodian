// Demo geography for the Insights choropleth.
//
// WHY THIS EXISTS: the map is built and styled ahead of the data that will feed
// it. A dev/staging tenant typically has a handful of awards with no resolved
// delivery geography at all, which renders an empty grey map and tells you
// nothing about whether the thing works.
//
// WHY IT IS LOUD ABOUT ITSELF: these are invented funding figures on a screen
// whose entire job is reporting where a foundation's money went. Shown quietly
// they would be indistinguishable from real portfolio data, which is a genuinely
// harmful thing to put in front of a trustee. So the panel renders a "Sample
// data" badge whenever `isDemo` is true, and the demo set is used ONLY when the
// real portfolio has no mappable geography whatsoever — never blended with, and
// never overriding, real grants. See `geoValues()` in the insights route.
//
// Delete this module once real awards carry delivery geography.

import type { AreaDatum } from '../../components/charts/Choropleth'

/** Deterministic — a fixed demo portfolio, not a random one, so the map does
 *  not reshuffle on every render and screenshots stay comparable. */
type DemoArea = { code: string; amount: number; count: number }
/** A district plus the region it drills down from. */
type DemoDistrict = DemoArea & { region: string }

// England's regions plus the three other nations, keyed the way `region` is
// persisted. Weighted to look like a plausible UK-wide funder: London-heavy,
// thin in the far north and Northern Ireland.
const REGIONS: DemoArea[] = [
  { code: 'London', amount: 1_240_000, count: 18 },
  { code: 'North West', amount: 685_000, count: 11 },
  { code: 'West Midlands', amount: 520_000, count: 9 },
  { code: 'Yorkshire and The Humber', amount: 445_000, count: 8 },
  { code: 'South East', amount: 390_000, count: 7 },
  { code: 'Scotland', amount: 305_000, count: 5 },
  { code: 'East of England', amount: 240_000, count: 5 },
  { code: 'North East', amount: 215_000, count: 4 },
  { code: 'Wales', amount: 180_000, count: 4 },
  { code: 'East Midlands', amount: 165_000, count: 3 },
  { code: 'South West', amount: 120_000, count: 3 },
  { code: 'Northern Ireland', amount: 75_000, count: 2 },
]

// Districts, keyed on ONS LAD code. Only a subset of each region is funded —
// that is the realistic case, and it exercises the "No funding" fill that a
// fully-painted demo map would hide.
const DISTRICTS: DemoDistrict[] = [
  // London — the drill-down that matters most, so it is the densest.
  { code: 'E09000019', amount: 265_000, region: 'London', count: 4 }, // Islington
  { code: 'E09000012', amount: 210_000, region: 'London', count: 3 }, // Hackney
  { code: 'E09000025', amount: 175_000, region: 'London', count: 3 }, // Newham
  { code: 'E09000030', amount: 150_000, region: 'London', count: 2 }, // Tower Hamlets
  { code: 'E09000022', amount: 120_000, region: 'London', count: 2 }, // Lambeth
  { code: 'E09000028', amount: 95_000, region: 'London', count: 1 }, // Southwark
  { code: 'E09000002', amount: 85_000, region: 'London', count: 1 }, // Barking and Dagenham
  { code: 'E09000007', amount: 75_000, region: 'London', count: 1 }, // Camden
  { code: 'E09000005', amount: 65_000, region: 'London', count: 1 }, // Brent
  // North West
  { code: 'E08000003', amount: 285_000, region: 'North West', count: 5 }, // Manchester
  { code: 'E08000012', amount: 180_000, region: 'North West', count: 3 }, // Liverpool
  { code: 'E08000001', amount: 120_000, region: 'North West', count: 2 }, // Bolton
  { code: 'E08000011', amount: 100_000, region: 'North West', count: 1 }, // Knowsley
  // West Midlands
  { code: 'E08000025', amount: 300_000, region: 'West Midlands', count: 5 }, // Birmingham
  { code: 'E08000031', amount: 130_000, region: 'West Midlands', count: 2 }, // Wolverhampton
  { code: 'E08000028', amount: 90_000, region: 'West Midlands', count: 2 }, // Sandwell
  // Yorkshire and The Humber
  { code: 'E08000035', amount: 195_000, region: 'Yorkshire and The Humber', count: 4 }, // Leeds
  { code: 'E08000019', amount: 140_000, region: 'Yorkshire and The Humber', count: 2 }, // Sheffield
  { code: 'E06000011', amount: 110_000, region: 'Yorkshire and The Humber', count: 2 }, // East Riding of Yorkshire
  // South East
  { code: 'E06000045', amount: 165_000, region: 'South East', count: 3 }, // Southampton
  { code: 'E06000044', amount: 125_000, region: 'South East', count: 2 }, // Portsmouth
  { code: 'E07000178', amount: 100_000, region: 'South East', count: 2 }, // Oxford
  // Scotland
  { code: 'S12000049', amount: 160_000, region: 'Scotland', count: 3 }, // Glasgow City
  { code: 'S12000036', amount: 95_000, region: 'Scotland', count: 1 }, // City of Edinburgh
  { code: 'S12000033', amount: 50_000, region: 'Scotland', count: 1 }, // Aberdeen City
  // East of England
  { code: 'E07000202', amount: 130_000, region: 'East of England', count: 3 }, // Ipswich
  { code: 'E06000055', amount: 110_000, region: 'East of England', count: 2 }, // Bedford
  // North East
  { code: 'E08000021', amount: 125_000, region: 'North East', count: 2 }, // Newcastle upon Tyne
  { code: 'E08000037', amount: 90_000, region: 'North East', count: 2 }, // Gateshead
  // Wales
  { code: 'W06000015', amount: 105_000, region: 'Wales', count: 2 }, // Cardiff
  { code: 'W06000011', amount: 75_000, region: 'Wales', count: 2 }, // Swansea
  // East Midlands
  { code: 'E06000018', amount: 100_000, region: 'East Midlands', count: 2 }, // Nottingham
  { code: 'E06000016', amount: 65_000, region: 'East Midlands', count: 1 }, // Leicester
  // South West
  { code: 'E06000023', amount: 120_000, region: 'South West', count: 3 }, // Bristol, City of
  // Northern Ireland
  { code: 'N09000003', amount: 75_000, region: 'Northern Ireland', count: 2 }, // Belfast
]

// A handful of international grants, keyed ISO alpha-3. The point of the world
// tier is that a delivery location outside the UK has somewhere to land — so the
// demo set deliberately includes one (Ukraine) that no UK geography could hold.
const COUNTRIES: DemoArea[] = [
  { code: 'GBR', amount: 4_580_000, count: 79 },
  { code: 'UKR', amount: 420_000, count: 4 },
  { code: 'KEN', amount: 265_000, count: 3 },
  { code: 'BGD', amount: 180_000, count: 2 },
  { code: 'ETH', amount: 145_000, count: 2 },
  { code: 'NPL', amount: 90_000, count: 1 },
]

function toMap(rows: DemoArea[]): Map<string, AreaDatum> {
  return new Map(rows.map((r) => [r.code, { amount: r.amount, count: r.count }]))
}

export const demoGeo = {
  world: () => toMap(COUNTRIES),
  regions: () => toMap(REGIONS),
  /** Districts within one region — the drill-down view. */
  districts: (region: string) => toMap(DISTRICTS.filter((d) => d.region === region)),
}
