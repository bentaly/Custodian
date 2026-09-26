// ─── Demo dataset: what the charity register "says" about each applicant ────────
//
// The application screen's Organisation panel reads `applications.organisation_profile`,
// which due diligence fills from the Charity Commission. The demo cannot let it: its
// applicants are fictional and their charity numbers are REAL (see `data.ts`), so the
// register answers with the real charity behind the number. Screened live, "Fair Start
// Careers" showed Age UK's income, staff and activities, with a link to Age UK's entry.
//
// So the profile is FIXTURE, like the narratives: written here, per applicant, and put
// on the row by `demo:apply` on every path (replayed or live), after the pipeline. The
// figures are invented and sized for the organisation each applicant is written as,
// small to mid-sized charities, which is what a grant round actually receives.
//
// Two fields are held null on purpose:
//   - `organisationNumber` is what the panel links to the public register with, and a
//     link from a fictional charity to a real one's entry is the thing this file exists
//     to prevent. The panel names the register without linking, as it does for any
//     profile written before the number was captured.
//   - `trusteeCount`, because due diligence's recorded `cc_trustee_count` check states
//     the REAL charity's count, and two different numbers on one screen is a bug report.
//
// `unrestrictedReserves` is null because the register never supplies it (see
// `OrganisationProfile`), so the panel shows its real "not captured" state.
//
// Company-only applicants (`growing`, `warmer`) get none: only the Charity Commission
// supplies a profile, and the panel has its own sentence for a company-only applicant.
//
// Copy rule: `activities` is shown to users, so no em dashes.

import type { OrganisationProfile } from '../../../src/lib/dueDiligence/types'
import type { DemoOrg } from './data'
import { daysFromNow } from './shared'

type ProfileSeed = {
  activities: string
  income: number
  expenditure: number
  employees: number
  volunteers: number
  registered: number
  charityType: 'Charitable incorporated organisation' | 'Charitable company' | 'Trust'
}

const CIO = 'Charitable incorporated organisation' as const

export const PROFILES: Record<string, ProfileSeed> = {
  // Youth Futures
  riverbank: {
    activities:
      'Youth work, mentoring and holiday provision for young people aged 11 to 19 on the Fylde coast, delivered from our centre and through detached work.',
    income: 612_400,
    expenditure: 598_900,
    employees: 14,
    volunteers: 40,
    registered: 1998,
    charityType: 'Charitable company',
  },
  northgate: {
    activities:
      'Supports young people in Middlesbrough to build confidence, skills and positive relationships through open access youth sessions and one to one support.',
    income: 284_150,
    expenditure: 291_700,
    employees: 7,
    volunteers: 22,
    registered: 2009,
    charityType: CIO,
  },
  lighthouse: {
    activities:
      'The advancement of education and the relief of need among children and young people in Knowsley and the surrounding area.',
    income: 438_900,
    expenditure: 421_300,
    employees: 11,
    volunteers: 18,
    registered: 2004,
    charityType: CIO,
  },
  streetwise: {
    activities:
      'Trained volunteer mentors matched with young people at risk of exclusion or offending in Birmingham, working alongside schools and youth justice services.',
    income: 356_700,
    expenditure: 362_050,
    employees: 8,
    volunteers: 65,
    registered: 2011,
    charityType: CIO,
  },
  cadence: {
    activities:
      'Music tuition, ensembles and instrument loans for children and young people in Bradford, free of charge to those who could not otherwise take part.',
    income: 197_300,
    expenditure: 188_600,
    employees: 5,
    volunteers: 30,
    registered: 2013,
    charityType: CIO,
  },
  fairstart: {
    activities:
      'Employability support for young people in Hull: careers guidance, pre-employment training and placements with local employers.',
    income: 422_800,
    expenditure: 409_500,
    employees: 10,
    volunteers: 12,
    registered: 2008,
    charityType: CIO,
  },
  ropewalk: {
    activities:
      'A youth centre in Nottingham offering evening sessions, sport, arts and a young leaders programme for 10 to 18 year olds.',
    income: 168_400,
    expenditure: 174_900,
    employees: 4,
    volunteers: 26,
    registered: 1994,
    charityType: 'Trust',
  },

  // Warm Homes
  threshold: {
    activities:
      'Free, independent housing advice and advocacy for tenants and homeowners in Rhondda Cynon Taf, including help with disrepair, arrears and homelessness.',
    income: 318_600,
    expenditure: 322_100,
    employees: 9,
    volunteers: 6,
    registered: 1986,
    charityType: CIO,
  },
  hearth: {
    activities:
      'Energy advice, home visits and small grants to help households in Glasgow keep warm and manage their fuel costs.',
    income: 246_900,
    expenditure: 239_400,
    employees: 6,
    volunteers: 15,
    registered: 2012,
    charityType: CIO,
  },
  newbridge: {
    activities:
      'Supports tenants and residents groups across Belfast to improve housing conditions and have a say in decisions about their homes.',
    income: 133_250,
    expenditure: 129_800,
    employees: 3,
    volunteers: 20,
    registered: 2002,
    charityType: CIO,
  },
  shelteredlives: {
    activities:
      'Practical support, home repairs and warm home checks for older people living independently in Leeds.',
    income: 511_300,
    expenditure: 526_750,
    employees: 13,
    volunteers: 48,
    registered: 1991,
    charityType: CIO,
  },
  coalfields: {
    activities:
      'The relief of poverty in former coalfield communities of South Yorkshire, in particular through advice on energy, debt and welfare benefits.',
    income: 274_500,
    expenditure: 268_200,
    employees: 7,
    volunteers: 9,
    registered: 2007,
    charityType: CIO,
  },

  // Wild Rivers
  chalkstreams: {
    activities:
      'Conserves and restores the chalk streams of Norfolk through habitat work, citizen science and landowner partnerships.',
    income: 689_200,
    expenditure: 655_400,
    employees: 12,
    volunteers: 110,
    registered: 1999,
    charityType: 'Charitable company',
  },
  upperdales: {
    activities:
      'River restoration, tree planting and water quality monitoring in the upper Swale and Ure catchments.',
    income: 402_700,
    expenditure: 388_300,
    employees: 9,
    volunteers: 75,
    registered: 2005,
    charityType: CIO,
  },
  wetland: {
    activities:
      'The conservation of wetland habitats on the east Norfolk coast and the education of the public in their value.',
    income: 231_600,
    expenditure: 244_100,
    employees: 5,
    volunteers: 60,
    registered: 1996,
    charityType: 'Trust',
  },
  greenway: {
    activities:
      'Brings communities, landowners and agencies together to improve rivers and green corridors across Stoke-on-Trent and north Staffordshire.',
    income: 187_900,
    expenditure: 181_200,
    employees: 4,
    volunteers: 45,
    registered: 2010,
    charityType: CIO,
  },
  peatland: {
    activities:
      'Restoring degraded peatland in the Highlands through ditch blocking, revegetation and monitoring, working with estates and crofting communities.',
    income: 574_300,
    expenditure: 560_900,
    employees: 11,
    volunteers: 35,
    registered: 2014,
    charityType: CIO,
  },
  riverkeepers: {
    activities:
      'Volunteer river keepers caring for the Taff and its tributaries: litter removal, invasive species control and pollution reporting.',
    income: 149_800,
    expenditure: 153_400,
    employees: 3,
    volunteers: 140,
    registered: 2012,
    charityType: CIO,
  },

  // Food Security
  larder: {
    activities:
      'A community food hub in Oldham providing low cost groceries, cooking classes and advice to families on low incomes.',
    income: 263_700,
    expenditure: 258_100,
    employees: 6,
    volunteers: 85,
    registered: 2015,
    charityType: CIO,
  },
  mealsmove: {
    activities:
      'Hot meal delivery and a wellbeing call for older and isolated people across Torbay, seven days a week.',
    income: 341_200,
    expenditure: 347_600,
    employees: 9,
    volunteers: 120,
    registered: 1989,
    charityType: CIO,
  },
  fenland: {
    activities:
      'Redistributes surplus food to community groups and runs pantries in north east Lincolnshire.',
    income: 298_400,
    expenditure: 285_900,
    employees: 7,
    volunteers: 95,
    registered: 2001,
    charityType: CIO,
  },
  breadoven: {
    activities:
      'A community bakery and cafe in Camborne offering training and paid work to people facing barriers to employment.',
    income: 176_500,
    expenditure: 181_300,
    employees: 6,
    volunteers: 14,
    registered: 1995,
    charityType: CIO,
  },
  secondharvest: {
    activities:
      'Turns surplus food into free community meals in Plymouth and teaches cooking and food hygiene skills.',
    income: 219_800,
    expenditure: 212_400,
    employees: 5,
    volunteers: 70,
    registered: 1997,
    charityType: CIO,
  },
}

/**
 * The end of the latest period a charity would have filed by now: the last 31 March at
 * least nine months back, which is what the register really shows (12 to 18 months old).
 * Relative to the run, like every demo date, or the dataset's accounts would go overdue.
 */
function latestFiledPeriodEnd(): string {
  const cutoff = daysFromNow(-270)
  let year = cutoff.getUTCFullYear()
  if (cutoff < new Date(Date.UTC(year, 2, 31))) year -= 1
  return `${year}-03-31`
}

/** The profile `demo:apply` writes for this applicant, or null where none is written. */
export function organisationProfileFor(org: DemoOrg): OrganisationProfile | null {
  const seed = PROFILES[org.key]
  if (!org.charityNumber || !seed) return null
  return {
    source: 'charity_commission',
    activities: seed.activities,
    latestIncome: seed.income,
    latestExpenditure: seed.expenditure,
    financialPeriodEnd: latestFiledPeriodEnd(),
    employees: seed.employees,
    volunteers: seed.volunteers,
    trusteeCount: null,
    registeredSince: `${seed.registered}-01-01`,
    charityType: seed.charityType,
    unrestrictedReserves: null,
    organisationNumber: null,
    fetchedAt: daysFromNow(0).toISOString(),
  }
}
