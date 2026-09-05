// ─── Due diligence: links back to the registers ──────────────────────────────
//
// A screen that states facts off a public register should be able to send a
// grants officer to the entry itself — the register is the authority, and the
// figures here are a snapshot with a date on them.
//
// The Charity Commission's public register does NOT address entries by charity
// number. Its URLs take `organisation_number`, the Commission's own id for the
// body, which comes back on the details call and is stored on the profile
// (`OrganisationProfile.organisationNumber`). With no organisation number there
// is no link to build, so the caller states the source without linking rather
// than guessing at a URL that would 404 in front of a foundation.

/** The public register entry for a charity, or null when we can't address one. */
export function charityRegisterUrl(organisationNumber: number | null | undefined): string | null {
  if (organisationNumber == null || !Number.isFinite(organisationNumber)) return null
  return `https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/${organisationNumber}/charity-overview`
}

/** The Companies House entry for a company number, which IS addressable directly. */
export function companiesHouseUrl(companyNumber: string | null | undefined): string | null {
  const n = companyNumber?.trim()
  if (!n) return null
  return `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(n)}`
}
