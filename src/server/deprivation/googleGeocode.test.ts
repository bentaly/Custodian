// Fixtures are the shape the Geocoding API really returns for the three inputs
// this swap exists to fix — a homonym city, a venue, and a county — trimmed to
// the fields the parser reads. No network: `parseGeocodeResult` is pure.
import { describe, expect, it } from 'vitest'
import {
  isWholeDistrict,
  looksLikeCounty,
  parseGeocodeResult,
  reportingLevel,
} from './googleGeocode'
import { LAD_EXTENT_KM } from '../../lib/deprivation/types'

const PRESTON = {
  address_components: [
    { long_name: 'Preston', short_name: 'Preston', types: ['postal_town'] },
    { long_name: 'Lancashire', short_name: 'Lancashire', types: ['administrative_area_level_2'] },
    { long_name: 'United Kingdom', short_name: 'GB', types: ['country', 'political'] },
  ],
  formatted_address: 'Preston, UK',
  geometry: {
    bounds: {
      northeast: { lat: 53.8296, lng: -2.6083 },
      southwest: { lat: 53.7248, lng: -2.7509 },
    },
    location: { lat: 53.7632, lng: -2.7031 },
    location_type: 'APPROXIMATE',
    // Deliberately much wider than `bounds` — Google always pads the viewport.
    viewport: {
      northeast: { lat: 54.0, lng: -2.3 },
      southwest: { lat: 53.5, lng: -3.0 },
    },
  },
  types: ['postal_town'],
}

// A stadium in Moston. The gazetteer this replaced held no venues at all, which is
// why "Broadhurst Park, Manchester" used to return nothing; Google types it an
// establishment and gives it no `bounds`, only a viewport.
const BROADHURST_PARK = {
  address_components: [
    { long_name: 'Broadhurst Park', short_name: 'Broadhurst Park', types: ['establishment'] },
    { long_name: 'Manchester', short_name: 'Manchester', types: ['postal_town'] },
  ],
  formatted_address: '310 Lightbowne Rd, Manchester M40 0FJ, UK',
  geometry: {
    location: { lat: 53.5093, lng: -2.1897 },
    location_type: 'ROOFTOP',
    viewport: {
      northeast: { lat: 53.5107, lng: -2.1881 },
      southwest: { lat: 53.5079, lng: -2.1913 },
    },
  },
  types: ['establishment', 'point_of_interest', 'stadium'],
}

describe('parseGeocodeResult', () => {
  it('takes the extent from bounds, not the padded viewport', () => {
    const p = parseGeocodeResult('Preston', PRESTON)!
    // bounds: 0.1048° of latitude ≈ 11.6km. The viewport would give ~55km, which
    // would push a city past LAD_EXTENT_KM and report it as a whole region.
    expect(p.extentKm).toBeCloseTo(11.63, 1)
  })

  it('names the place from the matched component, not the postal address', () => {
    // formatted_address is "310 Lightbowne Rd, Manchester M40 0FJ, UK" — a street.
    expect(parseGeocodeResult('Broadhurst Park, Manchester', BROADHURST_PARK)!.name).toBe(
      'Broadhurst Park',
    )
    expect(parseGeocodeResult('Preston', PRESTON)!.name).toBe('Preston')
  })

  it('falls back to the viewport when a venue has no bounds', () => {
    const p = parseGeocodeResult('Broadhurst Park, Manchester', BROADHURST_PARK)!
    // ~0.3km. Size no longer decides this — the `establishment` type does.
    expect(p.extentKm).toBeGreaterThan(0)
    expect(p.extentKm).toBeLessThan(1)
  })

  it('surfaces the signals a wrong match is currently invisible without', () => {
    const venue = parseGeocodeResult('Broadhurst Park, Manchester', BROADHURST_PARK)!
    expect(venue.types).toContain('establishment')
    expect(venue.locationType).toBe('ROOFTOP')
    expect(venue.partialMatch).toBe(false)

    const partial = parseGeocodeResult('Preston', { ...PRESTON, partial_match: true })!
    expect(partial.partialMatch).toBe(true)
  })

  it('returns null rather than a place with no coordinate', () => {
    expect(parseGeocodeResult('x', { geometry: {} })).toBeNull()
    expect(parseGeocodeResult('x', {})).toBeNull()
    expect(parseGeocodeResult('x', null)).toBeNull()
  })

  it('reports zero extent rather than throwing on a half-built box', () => {
    const p = parseGeocodeResult('x', {
      geometry: { location: { lat: 53, lng: -2 }, bounds: { northeast: { lat: 54, lng: -1 } } },
    })!
    expect(p.extentKm).toBe(0)
  })

  it('falls back to the formatted address, then the query, for a name', () => {
    const noComponents = {
      geometry: { location: { lat: 53, lng: -2 } },
      formatted_address: 'Ayr, UK',
    }
    expect(parseGeocodeResult('ayr', noComponents)!.name).toBe('Ayr')
    expect(parseGeocodeResult('ayr', { geometry: { location: { lat: 53, lng: -2 } } })!.name).toBe(
      'ayr',
    )
  })
})

describe('looksLikeCounty', () => {
  it('holds a county back from being scored as a district', () => {
    // Merseyside is five local authorities. Its bounding box is ~35km, which is
    // UNDER LAD_EXTENT_KM — so without this the centroid would pick one of the
    // five and silently drop Sefton, Knowsley, St Helens and Wirral.
    expect(looksLikeCounty(['administrative_area_level_2', 'political'])).toBe(true)
  })

  it('lets a city Google also tags as a county through as a city', () => {
    expect(looksLikeCounty(['locality', 'administrative_area_level_2', 'political'])).toBe(false)
    expect(looksLikeCounty(['postal_town', 'administrative_area_level_2'])).toBe(false)
  })

  it('is false for ordinary settlements, venues and a source that cannot say', () => {
    expect(looksLikeCounty(['postal_town'])).toBe(false)
    expect(looksLikeCounty(['establishment', 'point_of_interest'])).toBe(false)
    // `types` is optional on the interface, so a caller may not have them at all.
    expect(looksLikeCounty(undefined)).toBe(false)
    expect(looksLikeCounty([])).toBe(false)
  })
})

// ─── Which geography a match justifies ──────────────────────────────────────────
describe('reportingLevel', () => {
  const level = (types: string[], extentKm = 0, ladName: string | null = null, name = 'X') =>
    reportingLevel({ types, extentKm, name }, ladName, LAD_EXTENT_KM)

  it('reports a venue at the ward containing it, not at its own footprint', () => {
    // Broadhurst Park is ~0.3km of stadium. The question a trustee is asking is
    // "how deprived is Moston", not "how deprived is this car park".
    expect(level(['establishment', 'point_of_interest', 'stadium'], 0.31)).toBe('ward')
    expect(level(['premise'], 0.05)).toBe('ward')
    expect(level(['street_address'], 0.02)).toBe('ward')
  })

  it('reports a neighbourhood at ward level', () => {
    expect(level(['sublocality', 'political'], 2)).toBe('ward')
    expect(level(['neighborhood'], 2)).toBe('ward')
  })

  it('holds a county at the region, whatever its footprint says', () => {
    // Merseyside's box is 44.6km — but Greater Manchester's is 54.2km and both must
    // land the same way, so the type is what decides, not the size.
    expect(level(['administrative_area_level_2', 'political'], 44.64)).toBe('region')
    expect(level(['administrative_area_level_2'], 20)).toBe('region')
  })

  it('reports a statistical region or nation at region level', () => {
    expect(level(['administrative_area_level_1', 'political'], 120)).toBe('region')
  })

  it('declines a country outright', () => {
    expect(level(['country', 'political'], 900)).toBe('too_broad')
  })

  it('sends anything wider than a district to its region', () => {
    // Cumbria arrives as a colloquial_area, not a county — only its 127.58km
    // footprint says it is too big to report as Westmorland and Furness.
    expect(level(['colloquial_area', 'political'], 127.58, 'Westmorland and Furness')).toBe(
      'region',
    )
    // London: a locality whose name matches no district, and far too wide for one.
    expect(level(['locality', 'political'], 54, 'City of London', 'London')).toBe('region')
  })

  it('reports a settlement that IS its district at district level', () => {
    // Real Arete data. Reporting these at ward level gave the CENTROID's ward —
    // "Brinnington & Stockport Central", decile 1-3 typically 1, for a borough that
    // is not remotely that deprived.
    expect(level(['locality', 'political'], 8.79, 'Stockport', 'Stockport')).toBe('lad')
    expect(level(['locality', 'political'], 8.77, 'Preston', 'Preston')).toBe('lad')
    expect(level(['locality', 'political'], 5.95, 'Salford', 'Salford')).toBe('lad')
    expect(level(['locality', 'political'], 18.14, 'Liverpool', 'Liverpool')).toBe('lad')
  })

  it('reports a town inside a district at ward level', () => {
    // Birkenhead is 16.25km — it used to tip over the old 15km threshold and report
    // the whole of Wirral (typically 5) for a town that is deprived.
    expect(level(['locality', 'political'], 16.25, 'Wirral', 'Birkenhead')).toBe('ward')
    expect(level(['locality', 'political'], 5.36, 'Tameside', 'Ashton-under-Lyne')).toBe('ward')
  })

  it('falls back to ward when there is no district to compare against', () => {
    expect(level(['locality', 'political'], 5, null, 'Somewhere')).toBe('ward')
  })
})

describe('isWholeDistrict', () => {
  it("sees through the ONS register's spellings", () => {
    // Codes would be exact, but Google never returns one — so this comparison is
    // the join, and it has to survive the register's qualifiers.
    expect(isWholeDistrict('Bristol', 'Bristol, City of')).toBe(true)
    expect(isWholeDistrict('Kingston upon Hull', 'Kingston upon Hull, City of')).toBe(true)
    expect(isWholeDistrict('St Helens', 'St. Helens')).toBe(true)
    expect(isWholeDistrict('Edinburgh', 'City of Edinburgh')).toBe(true)
    expect(isWholeDistrict('Newcastle upon Tyne', 'Newcastle upon Tyne')).toBe(true)
  })

  it('does not match a town to the district containing it', () => {
    expect(isWholeDistrict('Birkenhead', 'Wirral')).toBe(false)
    expect(isWholeDistrict('Ashton-under-Lyne', 'Tameside')).toBe(false)
    expect(isWholeDistrict('Preston', null)).toBe(false)
  })
})
