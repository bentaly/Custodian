// ─── Demo dataset: the foundation ────────────────────────────────────────────
//
// The structural half of the fixture: the tenant, its programmes, its two rounds,
// its staff, and the organisations that apply to it.
//
// The foundation and every applicant are FICTIONAL, but each applicant carries a
// REAL charity/company registration number, verified against the live registers
// (see probe-registers.ts). That combination is deliberate:
//
//   - Real numbers mean due diligence genuinely runs and comes back green, with real
//     filing history and financials behind it. Invented numbers return "not found"
//     and the DD panel reads as broken, which is worse than no demo at all.
//   - Fictional names mean no real charity is ever shown on screen as declined,
//     rejected at the vote, or late with a report. That matters the moment this
//     dataset is shown to anyone outside the team.
//
// Due diligence screens by NUMBER only — it never cross-checks the organisation name
// against the register — so the two halves never contradict each other on screen.

import { PROGRAMME_PALETTE } from '../../../src/lib/programmeColours'

export const CLIENT = {
  name: 'The Wrenfield Foundation',
  type: 'charitable_foundation' as const,
  description:
    'An independent grant-maker funding work on youth opportunity, warm homes, river ' +
    'catchments and community food across the UK.',
  website: 'https://wrenfield.example',
  missionStatement:
    'The Wrenfield Foundation funds organisations working with communities that have ' +
    'the least, in the places that have been overlooked longest. We back practical work ' +
    'with a clear line to the people it helps, we fund the running costs that make it ' +
    'possible, and we prefer a smaller number of longer relationships to a large number ' +
    'of short ones.',
}

// Colours are taken from the generated ramp rather than invented, so no programme's
// swatch shouts louder than its neighbour's (see lib/programmeColours.ts).
const colour = (name: string) => PROGRAMME_PALETTE.find((c) => c.name === name)!.hex

export interface DemoProgramme {
  key: string
  name: string
  goal: string
  colour: string
  impactUnit: string
  impactUnitLabel?: string
  tags: string[]
}

export const PROGRAMMES: DemoProgramme[] = [
  {
    key: 'youth',
    name: 'Youth Futures',
    colour: colour('Blue'),
    impactUnit: 'people',
    tags: ['Young people', 'Education', 'Employment'],
    goal:
      'We fund work that helps 14–24 year olds in disadvantaged areas into education, ' +
      'training or work they actually want. We are looking for: sustained relationships ' +
      'rather than one-off interventions; genuine reach into communities where youth ' +
      'provision has been cut; and evidence that young people shaped the design. We are ' +
      'wary of programmes measured only by attendance, and of applicants who cannot say ' +
      'what happens to a young person after the funding ends.',
  },
  {
    key: 'homes',
    name: 'Warm Homes',
    colour: colour('Amber'),
    impactUnit: 'households',
    tags: ['Poverty', 'Housing', 'Energy'],
    goal:
      'We fund advice, advocacy and practical retrofit that keeps low-income households ' +
      'warm and out of fuel debt. We prioritise: casework that resolves the underlying ' +
      'problem rather than the immediate crisis; work in cold, hard-to-heat housing ' +
      'stock; and organisations trusted enough locally to reach households that do not ' +
      'come forward. We are cautious about one-off fuel voucher schemes with no advice ' +
      'attached.',
  },
  {
    key: 'rivers',
    name: 'Wild Rivers',
    colour: colour('Teal'),
    impactUnit: 'hectares',
    tags: ['Environment', 'Climate', 'Nature'],
    goal:
      'We fund catchment-scale restoration of rivers, wetlands and peatland, and the ' +
      'community stewardship that keeps it going. We look for: work with a named ' +
      'ecological outcome rather than general awareness-raising; partnerships that ' +
      'include landowners and the water companies where relevant; and monitoring that ' +
      'will still exist in five years. Volunteer engagement alone is not an outcome.',
  },
  {
    key: 'food',
    name: 'Community Food',
    colour: colour('Coral'),
    impactUnit: 'items',
    impactUnitLabel: 'meals and food parcels provided',
    tags: ['Food security', 'Poverty', 'Health'],
    goal:
      'We fund community food work that moves beyond emergency provision — growing, ' +
      'cooking, affordable food outlets and the infrastructure behind them. We favour: ' +
      'routes out of food insecurity rather than repeat parcels; dignity in how food is ' +
      'offered; and realistic plans for the cost of premises, vehicles and refrigeration. ' +
      'We will fund core costs where they are what actually limits reach.',
  },
]

// ─── Rounds ──────────────────────────────────────────────────────────────────
//
// Dates are OFFSETS in days from the seed run, resolved at seed time — an absolute
// calendar would leave the "open" round quietly closed a month from now, which is
// the one thing this dataset cannot afford to get wrong.

export type RoundKey = 'spring25' | 'summer25' | 'autumn25' | 'winter25' | 'spring26' | 'summer26'

export interface DemoRound {
  key: RoundKey
  name: string
  openedDaysAgo: number
  /** Negative = closes in the future (an open round). */
  closedDaysAgo: number | null
  /** Roughly when this round's decisions were made, as days ago. Awards and their
   *  schedules hang off this, which is what spreads giving across the calendar
   *  instead of stacking it on one date. */
  decidedDaysAgo: number
  /** Programme key → budget for that programme in this round. */
  budgets: Record<string, { budget: number; maxGrant: number; years: number }>
}

// FOUR ROUNDS A YEAR, seasonally named. A single annual round stacks every grant
// decision on one date, which makes the dashboard's giving-over-time chart a lone spike
// followed by months of nothing — true to the fixture, but not to how a foundation of
// this size actually gives. Quarterly rounds spread the decisions, so the chart shows a
// funder with a rhythm.
//
// Budgets are per-round (roughly a quarter of an annual allocation) and set close to what
// each programme actually committed, so the "committed of budget" bars read as a
// foundation spending its allocation rather than one that barely started. Wild Rivers in
// the OPEN round is deliberately over-subscribed — the shortlist proposes more than the
// budget holds, which is the case the "proposed against budget" card exists to surface,
// and it never appears if every bar is short.
const QUARTERLY = {
  youth: { budget: 62_000, maxGrant: 60_000, years: 2 },
  homes: { budget: 58_000, maxGrant: 50_000, years: 2 },
  rivers: { budget: 60_000, maxGrant: 60_000, years: 3 },
  food: { budget: 40_000, maxGrant: 40_000, years: 2 },
}

export const ROUNDS: DemoRound[] = [
  {
    key: 'spring25',
    name: 'Spring 2025',
    openedDaysAgo: 460,
    closedDaysAgo: 425,
    decidedDaysAgo: 395,
    budgets: QUARTERLY,
  },
  {
    key: 'summer25',
    name: 'Summer 2025',
    openedDaysAgo: 370,
    closedDaysAgo: 335,
    decidedDaysAgo: 305,
    budgets: QUARTERLY,
  },
  {
    key: 'autumn25',
    name: 'Autumn 2025',
    openedDaysAgo: 280,
    closedDaysAgo: 245,
    decidedDaysAgo: 215,
    budgets: QUARTERLY,
  },
  {
    key: 'winter25',
    name: 'Winter 2025',
    openedDaysAgo: 190,
    closedDaysAgo: 155,
    decidedDaysAgo: 125,
    budgets: QUARTERLY,
  },
  {
    key: 'spring26',
    name: 'Spring 2026',
    openedDaysAgo: 105,
    closedDaysAgo: 70,
    decidedDaysAgo: 45,
    budgets: QUARTERLY,
  },
  {
    key: 'summer26',
    name: 'Summer 2026',
    openedDaysAgo: 45,
    // Closes in three weeks — the round the demo is "in the middle of".
    closedDaysAgo: -21,
    decidedDaysAgo: -35,
    budgets: {
      youth: { budget: 180_000, maxGrant: 60_000, years: 3 },
      homes: { budget: 115_000, maxGrant: 50_000, years: 2 },
      rivers: { budget: 130_000, maxGrant: 75_000, years: 3 },
      food: { budget: 95_000, maxGrant: 40_000, years: 2 },
    },
  },
]

/** The round applications are currently being taken for. */
export const OPEN_ROUND: RoundKey = 'summer26'

// ─── Staff ───────────────────────────────────────────────────────────────────
//
// `@wrenfield.example` is an RFC 2606 reserved domain: these addresses can never
// receive mail, so no amount of clicking around the demo can send a real person an
// email. Passwords are seeded so each role can actually be signed into and shown —
// BetterAuth does not require a deliverable address to authenticate.
//
// The one real address (team@custodian.fund) is NOT created here: it already exists
// as a Google account and is attached by invitation, so the sign-in is the genuine
// product path rather than a row we wrote.

export interface DemoUser {
  name: string
  email: string
  role: 'admin' | 'trustee' | 'finance'
  password: string
}

export const DEMO_PASSWORD = 'wrenfield'

export const STAFF: DemoUser[] = [
  {
    name: 'Helen Ashworth',
    email: 'helen@wrenfield.example',
    role: 'admin',
    password: DEMO_PASSWORD,
  },
  {
    name: 'Marcus Reid',
    email: 'marcus@wrenfield.example',
    role: 'finance',
    password: DEMO_PASSWORD,
  },
  {
    name: 'Priya Raghavan',
    email: 'priya@wrenfield.example',
    role: 'trustee',
    password: DEMO_PASSWORD,
  },
  {
    name: 'Douglas Bain',
    email: 'douglas@wrenfield.example',
    role: 'trustee',
    password: DEMO_PASSWORD,
  },
  {
    name: 'Ngozi Adeyemi',
    email: 'ngozi@wrenfield.example',
    role: 'trustee',
    password: DEMO_PASSWORD,
  },
  {
    name: 'Tom Whitlock',
    email: 'tom@wrenfield.example',
    role: 'trustee',
    password: DEMO_PASSWORD,
  },
]

/** The address the demo tenant is administered from — attached by invitation. */
export const OWNER_EMAIL = 'team@custodian.fund'

// ─── Applicant organisations ─────────────────────────────────────────────────
//
// `charityNumber` / `companyNumber` are REAL and verified (see the header). Company
// numbers are stored in the canonical 8-character Companies House form — the charity
// register publishes them unpadded, and Companies House 404s on the unpadded value.
//
// `area` is where the funded work is DELIVERED, not where the organisation sits: it
// drives the deprivation lookup, so the set deliberately spans deciles and all four
// UK nations rather than clustering in one region.

export interface DemoOrg {
  key: string
  name: string
  charityNumber: string | null
  companyNumber: string | null
  area: string
  bankName: string
  sortCode: string
  accountNumber: string
}

// Applicants are overwhelmingly charity-registered, which is what a grant round
// actually looks like — most are CIOs holding a charity number and nothing else.
// Two exceptions are deliberate, so both other shapes can be seen on screen:
//   - `growing` and `warmer` are COMPANY-ONLY (a CIC and a community benefit
//     society) — they hold no charity registration, so due diligence screens them
//     against Companies House alone.
//   - `riverbank` and `chalkstreams` are DUAL-REGISTERED charitable companies, which
//     is the case where both registers are checked for the same applicant.
export const ORGS: DemoOrg[] = [
  // Youth Futures
  {
    key: 'riverbank',
    name: 'Riverbank Youth Trust',
    charityNumber: '202918',
    companyNumber: '00612172',
    area: 'Blackpool',
    bankName: 'Lloyds Bank',
    sortCode: '30-96-26',
    accountNumber: '74174024',
  },
  {
    key: 'northgate',
    name: "Northgate Young People's Project",
    charityNumber: '216250',
    companyNumber: null,
    area: 'Middlesbrough',
    bankName: 'Barclays',
    sortCode: '20-00-00',
    accountNumber: '58321177',
  },
  {
    key: 'lighthouse',
    name: 'The Lighthouse Youth Foundation',
    charityNumber: '216401',
    companyNumber: null,
    area: 'Knowsley',
    bankName: 'NatWest',
    sortCode: '60-00-01',
    accountNumber: '75578638',
  },
  {
    key: 'streetwise',
    name: 'Streetwise Mentoring',
    charityNumber: '263710',
    companyNumber: null,
    area: 'Birmingham',
    bankName: 'HSBC UK',
    sortCode: '40-02-50',
    accountNumber: '72226839',
  },
  {
    key: 'cadence',
    name: 'Cadence Music Education Trust',
    charityNumber: '219830',
    companyNumber: null,
    area: 'Bradford',
    bankName: 'Santander UK',
    sortCode: '09-01-29',
    accountNumber: '77048727',
  },
  {
    key: 'fairstart',
    name: 'Fair Start Careers',
    charityNumber: '1128267',
    companyNumber: null,
    area: 'Kingston upon Hull',
    bankName: 'Co-operative Bank',
    sortCode: '08-92-99',
    accountNumber: '83203206',
  },
  {
    key: 'ropewalk',
    name: 'The Ropewalk Youth Centre',
    charityNumber: '208231',
    companyNumber: null,
    area: 'Nottingham',
    bankName: 'Lloyds Bank',
    sortCode: '30-95-74',
    accountNumber: '45925693',
  },

  // Warm Homes
  {
    key: 'warmer',
    name: 'Warmer Futures Cooperative',
    charityNumber: null,
    companyNumber: '01900511',
    area: 'Sunderland',
    bankName: 'Unity Trust Bank',
    sortCode: '60-83-01',
    accountNumber: '33954686',
  },
  {
    key: 'threshold',
    name: 'Threshold Housing Advice',
    charityNumber: '294344',
    companyNumber: null,
    area: 'Rhondda Cynon Taf',
    bankName: 'Barclays',
    sortCode: '20-45-45',
    accountNumber: '73490288',
  },
  {
    key: 'hearth',
    name: 'The Hearth Project',
    charityNumber: '1110522',
    companyNumber: null,
    area: 'Glasgow',
    bankName: 'Bank of Scotland',
    sortCode: '80-22-60',
    accountNumber: '81710310',
  },
  {
    key: 'newbridge',
    name: "Newbridge Tenants' Support",
    charityNumber: '219432',
    companyNumber: null,
    area: 'Belfast',
    bankName: 'Danske Bank',
    sortCode: '95-01-21',
    accountNumber: '28578052',
  },
  {
    key: 'shelteredlives',
    name: 'Sheltered Lives Trust',
    charityNumber: '261017',
    companyNumber: null,
    area: 'Leeds',
    bankName: 'NatWest',
    sortCode: '60-13-15',
    accountNumber: '73729671',
  },
  {
    key: 'coalfields',
    name: 'Coalfields Energy Advice',
    charityNumber: '220949',
    companyNumber: null,
    area: 'Rotherham',
    bankName: 'Lloyds Bank',
    sortCode: '30-92-14',
    accountNumber: '53336405',
  },

  // Wild Rivers
  {
    key: 'chalkstreams',
    name: 'The Chalk Streams Partnership',
    charityNumber: '213890',
    companyNumber: '00178159',
    area: 'Norwich',
    bankName: 'Triodos Bank',
    sortCode: '16-58-10',
    accountNumber: '26601336',
  },
  {
    key: 'upperdales',
    name: 'Upper Dales Rivers Trust',
    charityNumber: '207994',
    companyNumber: null,
    area: 'Richmondshire',
    bankName: 'HSBC UK',
    sortCode: '40-27-15',
    accountNumber: '38179549',
  },
  // Deliberately mistyped (two digits transposed) so the Finance bank-check column
  // has a real failure to show — a screen where every row passes says nothing about
  // whether the check is running at all.
  {
    key: 'wetland',
    name: 'Wetland Futures',
    charityNumber: '1052076',
    companyNumber: null,
    area: 'Great Yarmouth',
    bankName: 'Barclays',
    sortCode: '20-65-82',
    accountNumber: '65742848',
  },
  {
    key: 'greenway',
    name: 'Greenway Catchment Alliance',
    charityNumber: '1082947',
    companyNumber: null,
    area: 'Stoke-on-Trent',
    bankName: 'Santander UK',
    sortCode: '09-06-66',
    accountNumber: '57256972',
  },
  {
    key: 'peatland',
    name: 'The Peatland Restoration Collective',
    charityNumber: '292411',
    companyNumber: null,
    area: 'Highland',
    bankName: 'Bank of Scotland',
    sortCode: '80-91-29',
    accountNumber: '75258004',
  },
  {
    key: 'riverkeepers',
    name: 'Riverkeepers Cymru',
    charityNumber: '212810',
    companyNumber: null,
    area: 'Merthyr Tydfil',
    bankName: 'Lloyds Bank',
    sortCode: '30-91-56',
    accountNumber: '69918072',
  },

  // Community Food
  {
    key: 'larder',
    name: 'The Larder Collective',
    charityNumber: '291558',
    companyNumber: null,
    area: 'Oldham',
    bankName: 'Co-operative Bank',
    sortCode: '08-92-50',
    accountNumber: '35025364',
  },
  {
    key: 'growing',
    name: 'Growing Together Allotments CIC',
    charityNumber: null,
    companyNumber: '07807276',
    area: 'Walsall',
    bankName: 'Unity Trust Bank',
    sortCode: '60-83-01',
    accountNumber: '66482235',
  },
  {
    key: 'mealsmove',
    name: 'Meals on the Move',
    charityNumber: '205846',
    companyNumber: null,
    area: 'Torbay',
    bankName: 'NatWest',
    sortCode: '60-11-01',
    accountNumber: '15165868',
  },
  {
    key: 'fenland',
    name: 'Fenland Food Network',
    charityNumber: '1081247',
    companyNumber: null,
    area: 'Great Grimsby',
    bankName: 'Barclays',
    sortCode: '20-71-32',
    accountNumber: '19508201',
  },
  {
    key: 'breadoven',
    name: 'The Bread Oven Project',
    charityNumber: '284934',
    companyNumber: null,
    area: 'Camborne',
    bankName: 'Triodos Bank',
    sortCode: '16-58-10',
    accountNumber: '31366088',
  },
  {
    key: 'secondharvest',
    name: 'Second Harvest Kitchens',
    charityNumber: '296645',
    companyNumber: null,
    area: 'Plymouth',
    bankName: 'HSBC UK',
    sortCode: '40-44-05',
    accountNumber: '13031179',
  },
]

export const ORG_BY_KEY: Record<string, DemoOrg> = Object.fromEntries(ORGS.map((o) => [o.key, o]))

/**
 * Grantee contact address. Plus-addressing on the one real inbox: every award letter
 * and report notification lands with you, while each grant still shows a distinct
 * address on screen — the same address repeated across twenty grants is the first
 * thing that reads as fake in a demo.
 */
export const contactEmail = (org: DemoOrg): string => `team+${org.key}@custodian.fund`
