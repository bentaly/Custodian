// ─── Demo dataset: the applications ──────────────────────────────────────────
//
// Forty submissions across six quarterly rounds — five closed, one open. Each carries genuinely different narrative
// content — not the same paragraph with the name swapped — because the Custodian
// score is a real model call over exactly this text. A fixture where every
// application reads the same produces forty identical scores, and a scoring feature
// that returns the same number for everything demonstrates nothing.
//
// So the set is written to span real quality: applications with a specific need, a
// named delivery method and evidence behind them; applications that are vague about
// what the money does; and applications asking for more than their track record
// supports. The spread the model produces from that is the point.
//
// `outcome` is what the decision layer (decide.ts) does with the application once it
// exists — it is NOT sent to the pipeline, which reaches its own verdict on the text.

import type { RoundKey } from './data'

export interface DemoAward {
  /** Awarded amount — often less than was asked for, which is ordinary. */
  amount: number
  purpose: string
  /** Bespoke conditions. Stored newline-joined; each becomes its own numbered clause. */
  conditions?: string[]
  /**
   * Not every grant is live. A portfolio that is 100% `active` never shows the
   * Awards screen doing the one thing it is for — distinguishing what is running from
   * what has finished — so the set deliberately includes both completed grants and one
   * that was cancelled part-way.
   */
  status?: 'active' | 'completed' | 'cancelled'
  /**
   * The payment schedule, stated explicitly rather than as a count: `daysFromStart`
   * relative to the grant start, and whether it has been paid. Explicit because the
   * interesting Finance states are exact — an instalment that fell due and was NOT paid
   * (overdue), and one falling due within the month — and a "split it into N annual
   * payments" rule cannot express either.
   *
   * A single-entry schedule is a one-off payment, which is what a smaller grant
   * usually is.
   */
  instalments: Array<{ daysFromStart: number; paid: boolean }>
  startDaysAgo: number
  reports: Array<{ label: string; dueDaysAgo: number; received: boolean }>
}

export interface DemoApplication {
  /** The foundation's own reference — the `externalApplicationId` canonical field. */
  ref: string
  org: string
  programme: string
  round: RoundKey
  amount: number
  impact?: number
  submittedDaysAgo: number
  outcome: 'awarded' | 'declined' | 'shortlisted' | 'for_review'
  project: string
  need: string
  approach: string
  evidence: string
  sustainability: string
  partners?: string
  budget?: Array<{ item: string; amount: number }>
  budgetLink?: string
  /** Canonical fields deliberately left out, so the "Not captured" panel has something
   *  real to report. A foundation whose form never asked is exactly this case. */
  omit?: Array<'deliveryArea' | 'budget' | 'impact'>
  award?: DemoAward
}

export const APPLICATIONS: DemoApplication[] = [
  // ═══ Past rounds (Spring 2025 → Spring 2026) ═════════════════════════════
  //
  // Spread across the five closed quarterly rounds — see ROUNDS in data.ts. Each
  // application's `round` says which one it belongs to.
  {
    ref: 'WF-2025-004',
    org: 'riverbank',
    programme: 'youth',
    round: 'spring25',
    amount: 58_000,
    impact: 210,
    submittedDaysAgo: 452,
    outcome: 'awarded',
    project: 'Detached youth work on the Grange and Mereside estates',
    need: 'Blackpool has the highest rate of 16–17 year olds not in education, employment or training in England. Both estates lost their council youth centre in 2019 and there is now no open-access provision within two bus routes.',
    approach:
      'Two full-time detached youth workers on the estates four evenings a week, building relationships on the street rather than waiting for referrals, with a weekly drop-in at the community centre for anyone who wants to go further into training or a college application.',
    evidence:
      'We have run detached work in Blackpool since 2016. Of the 84 young people we worked with intensively in 2023-24, 61 moved into education, training or employment within twelve months and 52 were still there at eighteen months. We track this through a shared data agreement with the local authority.',
    sustainability:
      'The local authority has committed to matching one worker post from 2027 if we can evidence the model over two years. This grant funds the two years that gets us there.',
    partners:
      'Blackpool Council youth offer, Blackpool and The Fylde College, two secondary schools.',
    budget: [
      { item: 'Detached youth workers (2 FTE, 2 years)', amount: 74_000 },
      { item: 'Sessional support workers', amount: 9_400 },
      { item: 'Training and safeguarding', amount: 3_200 },
      { item: 'Transport and equipment', amount: 4_800 },
      { item: 'Evaluation', amount: 3_500 },
    ],
    award: {
      amount: 52_000,
      purpose: 'two years of detached youth work on the Grange and Mereside estates in Blackpool',
      status: 'completed',
      instalments: [
        { daysFromStart: 0, paid: true },
        { daysFromStart: 365, paid: true },
      ],
      startDaysAgo: 380,
      reports: [
        { label: 'Interim report', dueDaysAgo: 200, received: true },
        { label: 'Final report', dueDaysAgo: 20, received: true },
      ],
    },
  },
  {
    ref: 'WF-2025-011',
    org: 'northgate',
    programme: 'youth',
    round: 'summer25',
    amount: 44_500,
    impact: 160,
    submittedDaysAgo: 362,
    outcome: 'awarded',
    project: 'Transitions: supported college entry for care-experienced young people',
    need: 'Care-experienced young people in Middlesbrough drop out of college at roughly three times the rate of their peers, most often in the first eight weeks. The support that exists starts at enrolment and stops at Christmas.',
    approach:
      'A named worker attached to each young person from the March before they apply through to the end of their first year — help with the application, the bursary paperwork, the first-week logistics that derail people, and a standing weekly check-in that continues whether or not they are still enrolled.',
    evidence:
      'We piloted this with 22 young people in 2023 with a small grant from the Hospital of God. Nineteen completed their first year against a local baseline of about eleven. The pilot report is attached.',
    sustainability:
      'Middlesbrough Council has indicated it would commission this from 2028 if the retention figures hold across a larger cohort.',
    partners: 'Middlesbrough Council leaving-care team, Middlesbrough College.',
    budget: [
      { item: 'Transitions workers (1.5 FTE, 2 years)', amount: 52_000 },
      { item: 'Bursary and emergency fund', amount: 6_000 },
      { item: 'Travel', amount: 2_400 },
      { item: 'Evaluation partner', amount: 4_000 },
    ],
    award: {
      amount: 44_500,
      purpose:
        'supported college entry and first-year retention for care-experienced young people in Middlesbrough',
      conditions: [
        'Grant is restricted to direct delivery costs and may not be applied to central overheads.',
      ],
      status: 'completed',
      instalments: [{ daysFromStart: 0, paid: true }],
      startDaysAgo: 295,
      reports: [{ label: 'Final report', dueDaysAgo: 110, received: true }],
    },
  },
  {
    ref: 'WF-2025-019',
    org: 'lighthouse',
    programme: 'youth',
    round: 'spring25',
    amount: 60_000,
    impact: 900,
    submittedDaysAgo: 440,
    outcome: 'declined',
    project: 'Youth engagement programme',
    need: 'Young people in Knowsley face significant challenges around employment, mental health and community cohesion. There is a need for more youth provision in the area.',
    approach:
      'We will deliver a programme of activities including sports, arts and personal development sessions, reaching as many young people as possible across the borough through our existing network of venues.',
    evidence:
      'We have been established for over thirty years and work with thousands of young people annually. Feedback from participants is consistently positive.',
    sustainability:
      'We will seek further funding from a range of sources including trusts, foundations and corporate partners.',
    budget: [
      { item: 'Staff costs', amount: 45_000 },
      { item: 'Activities', amount: 10_000 },
      { item: 'Overheads', amount: 5_000 },
    ],
  },
  {
    ref: 'WF-2025-023',
    org: 'streetwise',
    programme: 'youth',
    round: 'winter25',
    amount: 39_000,
    impact: 120,
    submittedDaysAgo: 182,
    outcome: 'awarded',
    project: 'Peer mentoring for young people excluded from mainstream school',
    need: 'Birmingham permanently excludes more pupils than any other local authority outside London. Once a young person is in alternative provision, the chance of any sustained adult relationship outside their family drops sharply.',
    approach:
      'We match each young person with a mentor who was themselves excluded and is now in work or study, for a minimum of nine months, with fortnightly paid supervision for mentors and a clear exit plan rather than an open-ended relationship.',
    evidence:
      'Our 2022-24 cohort of 96 young people: 71 completed nine months, 58 were in education, employment or training at exit. Independently evaluated by Birmingham City University — report attached.',
    sustainability:
      'Two secondary academies have begun paying per-place from their pupil premium, which now covers about a fifth of delivery.',
    partners: 'Four alternative provision settings, Birmingham City University.',
    budget: [
      { item: 'Mentor stipends and supervision', amount: 26_000 },
      { item: 'Coordinator (0.6 FTE)', amount: 18_500 },
      { item: 'Mentor training', amount: 4_200 },
      { item: 'Evaluation', amount: 3_000 },
    ],
    award: {
      amount: 39_000,
      purpose: 'peer mentoring for young people in alternative provision across Birmingham',
      status: 'active',
      instalments: [{ daysFromStart: 0, paid: true }],
      startDaysAgo: 115,
      reports: [{ label: 'Annual report', dueDaysAgo: 45, received: true }],
    },
  },
  {
    ref: 'WF-2025-014',
    org: 'threshold',
    programme: 'homes',
    round: 'autumn25',
    amount: 42_000,
    impact: 380,
    submittedDaysAgo: 272,
    outcome: 'awarded',
    project: 'Cold homes advocacy in the Rhondda valleys',
    need: 'The terraced housing of the upper Rhondda is among the hardest to heat in Wales — solid wall, off the gas grid in places, and largely privately rented. Tenants who complain about damp are frequently served a notice instead of a repair.',
    approach:
      'Two advocates providing housing-condition casework: damp and mould reports, Housing Health and Safety Rating System referrals to the council, and representation at tribunal where a landlord retaliates.',
    evidence:
      'We took 214 cold-homes cases last year. 96 resulted in works being carried out; 31 went to the council as formal complaints; we defended 11 retaliatory eviction attempts and won 9.',
    sustainability:
      'Welsh Government housing grants cover part of our core costs but not this specialist casework.',
    partners: 'Rhondda Cynon Taf council environmental health, Shelter Cymru.',
    budget: [
      { item: 'Housing advocates (2 FTE, 2 years)', amount: 68_000 },
      { item: 'Damp survey equipment and training', amount: 5_400 },
      { item: 'Legal costs fund', amount: 6_000 },
    ],
    award: {
      amount: 42_000,
      purpose: 'cold homes advocacy and housing-condition casework in the Rhondda valleys',
      status: 'active',
      instalments: [
        { daysFromStart: 0, paid: true },
        { daysFromStart: 220, paid: false },
      ],
      startDaysAgo: 205,
      reports: [
        { label: 'Interim report', dueDaysAgo: 100, received: true },
        { label: 'Final report', dueDaysAgo: 12, received: false },
      ],
    },
  },
  {
    ref: 'WF-2025-021',
    org: 'hearth',
    programme: 'homes',
    round: 'summer25',
    amount: 50_000,
    impact: 1200,
    submittedDaysAgo: 350,
    outcome: 'declined',
    project: 'Winter fuel voucher scheme',
    need: 'Many households in Glasgow cannot afford to heat their homes in winter.',
    approach:
      'We will distribute fuel vouchers of £49 to households referred by partner agencies, targeting 1,200 households over the winter period.',
    evidence:
      'We distributed 800 vouchers last winter and recipients reported that the support was helpful.',
    sustainability: 'We will apply to other funders next year.',
    budget: [
      { item: 'Fuel vouchers', amount: 58_800 },
      { item: 'Administration', amount: 4_000 },
    ],
  },
  {
    ref: 'WF-2025-027',
    org: 'newbridge',
    programme: 'homes',
    round: 'winter25',
    amount: 36_000,
    impact: 240,
    submittedDaysAgo: 172,
    outcome: 'declined',
    project: 'Tenant support service for west Belfast',
    need: 'Tenants in the private rented sector in west Belfast have very little access to independent advice, and Northern Ireland lacks much of the tenant protection that exists in Great Britain.',
    approach:
      'A part-time adviser offering drop-in sessions at three community venues, plus a telephone line.',
    evidence:
      'We have supported tenants informally for years and demand consistently exceeds what our volunteers can handle.',
    sustainability: 'We are exploring statutory funding through the Housing Executive.',
    budget: [
      { item: 'Adviser (0.8 FTE, 2 years)', amount: 31_000 },
      { item: 'Venue hire', amount: 2_400 },
      { item: 'Telephone and IT', amount: 1_800 },
    ],
  },
  {
    ref: 'WF-2025-034',
    org: 'shelteredlives',
    programme: 'homes',
    round: 'spring26',
    amount: 49_500,
    impact: 300,
    submittedDaysAgo: 96,
    outcome: 'declined',
    project: 'Retrofit advice for older owner-occupiers',
    need: 'Older people in Leeds living in under-insulated owner-occupied homes often have capital tied up in the property but no income to fund improvements, and find the retrofit market confusing and untrustworthy.',
    approach:
      'An independent advice service helping older homeowners understand what measures suit their property, what grants exist, and how to appoint a contractor without being mis-sold.',
    evidence:
      'We ran a small pilot with 40 households. Most found it useful, though only a handful went on to install measures within the pilot period.',
    sustainability: 'Not yet determined.',
    budget: [
      { item: 'Retrofit advisers (1.5 FTE)', amount: 41_000 },
      { item: 'Training and accreditation', amount: 5_500 },
      { item: 'Marketing', amount: 3_000 },
    ],
  },
  {
    ref: 'WF-2025-041',
    org: 'coalfields',
    programme: 'homes',
    round: 'spring26',
    amount: 38_000,
    impact: 410,
    submittedDaysAgo: 100,
    outcome: 'awarded',
    project: 'Energy advice in the former coalfield villages of Rotherham',
    need: 'The ex-mining villages east of Rotherham have concessionary-coal-era housing built without central heating, an ageing population, and no advice provision since the local Citizens Advice office closed in 2021.',
    approach:
      'A mobile advice service visiting each of nine villages on a fixed weekly rota, offering income maximisation, tariff checks, and referral into the council retrofit scheme, delivered from a converted van so it reaches people who cannot travel.',
    evidence:
      'The rota model has run in three villages since 2022 on local authority funding. 340 households advised, average annual saving of £410 per household, verified by follow-up call at six months.',
    sustainability:
      'The council funds the three original villages; this grant extends the rota to the remaining six, which the council has said it will absorb if demand is demonstrated.',
    partners: 'Rotherham MBC, Coalfields Regeneration Trust.',
    budget: [
      { item: 'Advisers (2 FTE, 2 years)', amount: 62_000 },
      { item: 'Vehicle running costs', amount: 6_800 },
      { item: 'Village venue costs', amount: 2_200 },
    ],
    award: {
      amount: 38_000,
      purpose: 'a mobile energy advice service across nine former coalfield villages in Rotherham',
      status: 'active',
      instalments: [
        { daysFromStart: 0, paid: true },
        { daysFromStart: 365, paid: false },
      ],
      startDaysAgo: 35,
      reports: [{ label: 'Annual report', dueDaysAgo: -330, received: false }],
    },
  },
  {
    ref: 'WF-2025-017',
    org: 'upperdales',
    programme: 'rivers',
    round: 'summer25',
    amount: 52_000,
    impact: 30,
    submittedDaysAgo: 342,
    outcome: 'declined',
    project: 'River Swale catchment improvement',
    need: 'The River Swale suffers from diffuse agricultural pollution and habitat degradation along much of its length.',
    approach:
      'We will work with farmers in the catchment to improve land management practices and undertake habitat improvement works at priority sites.',
    evidence:
      'We have a good relationship with the farming community in the dales and have delivered similar work previously.',
    sustainability: 'Ongoing management will be undertaken by landowners.',
    budget: [
      { item: 'Catchment officer', amount: 38_000 },
      { item: 'Habitat works', amount: 12_000 },
      { item: 'Farmer engagement', amount: 4_000 },
    ],
  },
  {
    ref: 'WF-2025-025',
    org: 'wetland',
    programme: 'rivers',
    round: 'winter25',
    amount: 44_000,
    impact: 62,
    submittedDaysAgo: 178,
    outcome: 'awarded',
    project: 'Broadland grazing marsh: 62 hectares under water-level management',
    need: 'The Halvergate marshes are drying. Drainage infrastructure built for arable conversion in the 1970s still runs, and breeding wader numbers on the site have fallen by around 60% since 2005.',
    approach:
      'Install eleven adjustable sluices and two solar-powered pumps to hold winter water on 62 hectares, with a water-level management plan agreed with the internal drainage board and monitored by breeding-bird survey each spring.',
    evidence:
      'We manage 340 hectares of grazing marsh across Broadland. On our Berney site, the same intervention took breeding lapwing from 4 pairs to 27 over six years.',
    sustainability:
      'The site is in a Higher Level Stewardship agreement to 2034 which funds grazing and sluice maintenance.',
    partners: 'Broads Authority, Broadland Internal Drainage Board, RSPB.',
    budget: [
      { item: 'Sluice installation (11 units)', amount: 34_000 },
      { item: 'Solar pump units', amount: 12_500 },
      { item: 'Water-level management planning', amount: 4_500 },
      { item: 'Breeding bird survey (3 years)', amount: 6_000 },
    ],
    award: {
      amount: 41_000,
      purpose: 'water-level management works across 62 hectares of Broadland grazing marsh',
      status: 'cancelled',
      instalments: [
        { daysFromStart: 0, paid: true },
        { daysFromStart: 365, paid: false },
      ],
      startDaysAgo: 110,
      reports: [{ label: 'Annual report', dueDaysAgo: 20, received: false }],
    },
  },
  {
    ref: 'WF-2025-018',
    org: 'growing',
    programme: 'food',
    round: 'spring25',
    amount: 32_000,
    impact: 12_000,
    submittedDaysAgo: 432,
    outcome: 'declined',
    project: 'Community growing spaces in Walsall',
    need: 'Access to fresh produce is limited in parts of Walsall and many residents have no garden.',
    approach:
      'We will develop two community growing sites with raised beds and a polytunnel, running weekly sessions for local residents.',
    evidence:
      'Our existing site is popular and produces a reasonable quantity of vegetables each season.',
    sustainability: 'We will charge a small plot fee and sell surplus produce.',
    budget: [
      { item: 'Site preparation and raised beds', amount: 18_000 },
      { item: 'Polytunnel', amount: 7_500 },
      { item: 'Sessional grower', amount: 6_500 },
    ],
  },
  {
    ref: 'WF-2025-029',
    org: 'mealsmove',
    programme: 'food',
    round: 'autumn25',
    amount: 29_000,
    impact: 26_000,
    submittedDaysAgo: 252,
    outcome: 'declined',
    project: 'Meals delivery for housebound older people in Torbay',
    need: 'Older people in Torbay who are housebound after a hospital stay often have no way of getting a hot meal, and the council service was withdrawn in 2022.',
    approach:
      'A volunteer-driven meal delivery round covering Torquay and Paignton five days a week.',
    evidence: 'We currently deliver around 120 meals a week using two vans and a volunteer rota.',
    sustainability:
      'Recipients contribute £3.50 per meal which covers ingredients but not vehicle or staff costs.',
    budget: [
      { item: 'Van replacement', amount: 18_500 },
      { item: 'Kitchen coordinator (0.5 FTE)', amount: 13_000 },
    ],
  },
  {
    ref: 'WF-2025-036',
    org: 'fenland',
    programme: 'food',
    round: 'winter25',
    amount: 34_000,
    impact: 18_000,
    submittedDaysAgo: 160,
    outcome: 'declined',
    project: 'Food network coordination for north east Lincolnshire',
    need: 'There are fourteen separate food projects in Grimsby and Cleethorpes with no coordination between them, leading to duplication in some areas and gaps in others.',
    approach:
      'A coordinator post to map provision, share surplus between projects, and set up a joint referral route.',
    evidence: 'We convened an initial meeting which twelve of the fourteen projects attended.',
    sustainability:
      'We hope member projects will contribute to the coordinator cost once the value is demonstrated.',
    budget: [
      { item: 'Network coordinator (1 FTE, 2 years)', amount: 58_000 },
      { item: 'Shared logistics', amount: 6_000 },
    ],
  },
  {
    ref: 'WF-2025-043',
    org: 'breadoven',
    programme: 'food',
    round: 'spring26',
    amount: 27_500,
    impact: 9_000,
    submittedDaysAgo: 76,
    outcome: 'declined',
    project: 'Community bakery training programme',
    need: 'Camborne has high levels of long-term unemployment and few routes into food-sector work.',
    approach:
      'A twelve-week baking course for unemployed adults, run from our community bakery, with a qualification at the end.',
    evidence: 'We have run three cohorts informally with good attendance.',
    sustainability: 'Bakery sales contribute to running costs.',
    omit: ['deliveryArea'],
    budget: [
      { item: 'Baker-tutor (0.6 FTE)', amount: 17_000 },
      { item: 'Ingredients and materials', amount: 5_500 },
      { item: 'Qualification fees', amount: 3_200 },
    ],
  },

  {
    ref: 'WF-2025-007',
    org: 'warmer',
    programme: 'homes',
    round: 'spring25',
    amount: 47_000,
    impact: 520,
    submittedDaysAgo: 448,
    outcome: 'awarded',
    project: 'Fuel debt casework across Sunderland',
    need: 'Sunderland has some of the coldest housing stock in the North East and average fuel debt among households we see has risen from £480 to £1,340 in three years. Households in debt to a supplier are frequently ineligible for the crisis schemes designed to help them.',
    approach:
      'Three caseworkers taking referrals from GPs, food banks and housing officers, working each case through to resolution — supplier negotiation, benefit checks, Warm Home Discount and Priority Services Register applications — rather than issuing a voucher and closing the file.',
    evidence:
      'In 2023-24 we closed 780 cases, wrote off or rescheduled £612,000 of fuel debt, and secured £340,000 in previously unclaimed benefit income. Median time to resolution was 46 days.',
    sustainability:
      'Northern Powergrid funds one post directly and we are in discussion about a second. Advice work of this kind will always need grant funding.',
    partners: 'Sunderland City Council, Northern Powergrid, six GP practices.',
    budget: [
      { item: 'Caseworkers (3 FTE, 2 years)', amount: 96_000 },
      { item: 'Supervision and quality assurance', amount: 11_000 },
      { item: 'Crisis fund', amount: 8_000 },
      { item: 'Case management system', amount: 3_600 },
    ],
    award: {
      amount: 47_000,
      purpose: 'fuel debt casework for low-income households across Sunderland',
      status: 'active',
      instalments: [
        { daysFromStart: 0, paid: true },
        { daysFromStart: 365, paid: true },
        { daysFromStart: 730, paid: false },
      ],
      startDaysAgo: 375,
      reports: [
        { label: 'Interim report', dueDaysAgo: 190, received: true },
        { label: 'Year two report', dueDaysAgo: -170, received: false },
      ],
    },
  },
  {
    ref: 'WF-2025-009',
    org: 'chalkstreams',
    programme: 'rivers',
    round: 'summer25',
    amount: 57_000,
    impact: 46,
    submittedDaysAgo: 358,
    outcome: 'awarded',
    project: 'Restoring the upper Wensum: 46 hectares of floodplain reconnection',
    need: 'The Wensum is one of about 200 chalk streams in the world and is failing its conservation objectives on phosphate and sediment. Two kilometres of the upper river were straightened and embanked for post-war drainage, disconnecting the floodplain entirely.',
    approach:
      'Remove 1.8km of embankment, re-meander the channel through its original course, and reconnect 46 hectares of floodplain grazing marsh, working with three landowners who have all signed heads of terms.',
    evidence:
      'We completed a comparable 28-hectare scheme on the Nar in 2021. Post-works monitoring shows invertebrate community index up 34% and phosphate down by a third at the downstream gauge.',
    sustainability:
      'Landowners enter 20-year Countryside Stewardship agreements as a condition of the works, which funds ongoing management.',
    partners: 'Norfolk Rivers Trust, Environment Agency, Anglian Water, three landowners.',
    budget: [
      { item: 'Earthworks and channel restoration', amount: 68_000 },
      { item: 'Ecological survey and consenting', amount: 11_500 },
      { item: 'Five-year monitoring programme', amount: 14_000 },
      { item: 'Project management', amount: 9_000 },
    ],
    award: {
      amount: 57_000,
      purpose: 'floodplain reconnection and channel restoration on the upper River Wensum',
      conditions: [
        'No works may commence until all Environment Agency consents are in place and copies provided.',
        'Twenty-year Countryside Stewardship agreements must be signed by all three landowners before the second instalment is released.',
      ],
      status: 'active',
      instalments: [
        { daysFromStart: 0, paid: true },
        { daysFromStart: 365, paid: false },
        { daysFromStart: 730, paid: false },
      ],
      startDaysAgo: 290,
      reports: [
        { label: 'Interim report', dueDaysAgo: 115, received: true },
        { label: 'Year one ecological monitoring', dueDaysAgo: -55, received: false },
      ],
    },
  },
  {
    ref: 'WF-2025-012',
    org: 'larder',
    programme: 'food',
    round: 'autumn25',
    amount: 36_000,
    impact: 42_000,
    submittedDaysAgo: 268,
    outcome: 'awarded',
    project: 'The Larder pantry network: from parcels to membership',
    need: 'Oldham has eleven food banks and no affordable food outlet. Food bank use here has plateaued not because need has fallen but because people stop coming — our own exit survey found shame was the most common reason given for not returning.',
    approach:
      'Convert three of our parcel sites into membership pantries: £4.50 a week for around £25 of shopping, chosen by the member rather than packed for them. Members join through the same referral routes but stay an average of nine months rather than three visits.',
    evidence:
      'Our first pantry opened in Failsworth in 2023. 310 member households, 78% still active after six months, and referrals into our debt advice service up fourfold because people come back often enough to build trust.',
    sustainability:
      'Membership fees cover about 55% of running costs at scale; this grant funds the conversion and the first eighteen months of the gap.',
    partners: 'Your Local Pantry, Oldham Council, FareShare Greater Manchester.',
    budget: [
      { item: 'Refrigeration and shelving (3 sites)', amount: 21_000 },
      { item: 'Pantry coordinator (1 FTE, 2 years)', amount: 58_000 },
      { item: 'Van lease and running costs', amount: 9_600 },
      { item: 'Membership system', amount: 2_800 },
    ],
    award: {
      amount: 36_000,
      purpose: 'converting three food parcel sites in Oldham into membership pantries',
      status: 'active',
      // The overdue payment: this instalment fell due three weeks ago and has not been
      // paid, so Finance has a real arrears case rather than a clean list.
      instalments: [
        { daysFromStart: 0, paid: true },
        { daysFromStart: 180, paid: false },
      ],
      startDaysAgo: 200,
      reports: [
        { label: 'Interim report', dueDaysAgo: 105, received: true },
        { label: 'Final report', dueDaysAgo: -30, received: false },
      ],
    },
  },
  {
    ref: 'WF-2025-031',
    org: 'cadence',
    programme: 'youth',
    round: 'autumn25',
    amount: 55_000,
    impact: 400,
    submittedDaysAgo: 260,
    outcome: 'declined',
    project: 'Music production studio for young people in Bradford',
    need: 'Young people in inner-city Bradford have limited access to creative facilities and music production equipment.',
    approach:
      'We will fit out a professional-standard recording studio at our premises and run after-school sessions in music production, songwriting and performance.',
    evidence:
      'Our existing music sessions are well attended and we have a waiting list of over sixty young people.',
    sustainability:
      'The studio will be hired commercially outside session hours, which we expect to cover running costs within three years.',
    budget: [
      { item: 'Studio fit-out and acoustic treatment', amount: 31_000 },
      { item: 'Recording equipment', amount: 14_500 },
      { item: 'Tutor costs (year one)', amount: 9_500 },
    ],
  },
  {
    ref: 'WF-2025-032',
    org: 'greenway',
    programme: 'rivers',
    round: 'winter25',
    amount: 46_000,
    impact: 25,
    submittedDaysAgo: 166,
    outcome: 'declined',
    project: 'Urban river corridor improvements, Stoke-on-Trent',
    need: 'The River Trent through Stoke is heavily modified and culverted in places, with poor water quality and limited public access.',
    approach:
      'A programme of community engagement, litter picks, and small-scale habitat improvements along the urban river corridor.',
    evidence: 'We hold regular volunteer events which are well attended by local residents.',
    sustainability: 'Volunteers will continue to maintain the sites.',
    omit: ['impact'],
    budget: [
      { item: 'Community engagement officer', amount: 32_000 },
      { item: 'Volunteer events and equipment', amount: 8_000 },
      { item: 'Habitat works', amount: 6_000 },
    ],
  },
  {
    ref: 'WF-2025-038',
    org: 'ropewalk',
    programme: 'youth',
    round: 'spring26',
    amount: 48_000,
    impact: 250,
    submittedDaysAgo: 84,
    outcome: 'declined',
    project: 'Extending opening hours at The Ropewalk',
    need: 'Our youth centre currently opens three evenings a week. Young people tell us they want somewhere to go at weekends, when there is nothing else open in this part of Nottingham.',
    approach:
      'Open Saturday and Sunday afternoons with a staffed programme of sport, cooking and informal support.',
    evidence:
      'We see around 90 young people a week across our three evenings. We have run occasional weekend sessions which were well attended.',
    sustainability: 'We hope that increased usage will strengthen future funding applications.',
    omit: ['budget'],
  },
  {
    ref: 'WF-2025-039',
    org: 'peatland',
    programme: 'rivers',
    round: 'spring26',
    amount: 60_000,
    impact: 140,
    submittedDaysAgo: 90,
    outcome: 'declined',
    project: 'Flow Country peatland restoration',
    need: 'Degraded blanket bog in Caithness and Sutherland continues to emit carbon and deliver sediment into headwater streams.',
    approach:
      'Ditch blocking and hagg reprofiling across 140 hectares of degraded blanket bog on two estates.',
    evidence: 'We have restored around 900 hectares since 2018 with Peatland ACTION funding.',
    sustainability: 'Restored sites require little intervention once vegetation re-establishes.',
    partners: 'NatureScot Peatland ACTION, two private estates.',
    budget: [
      { item: 'Contractor ditch blocking', amount: 71_000 },
      { item: 'Hagg reprofiling', amount: 22_000 },
      { item: 'Baseline and post-works survey', amount: 9_000 },
    ],
  },

  // ═══ Summer 2026 — THE OPEN ROUND ════════════════════════════════════════
  {
    ref: 'WF-2026-003',
    org: 'riverbank',
    programme: 'youth',
    round: 'summer26',
    amount: 60_000,
    impact: 240,
    submittedDaysAgo: 38,
    outcome: 'shortlisted',
    project: 'Extending detached youth work to Central and Talbot wards',
    need: 'The two wards we do not currently reach have the highest rates of first-time entrants to the youth justice system in Blackpool. Our current provision stops at the ward boundary for no reason other than funding.',
    approach:
      'A third detached team covering Central and Talbot four evenings a week on the model already running on Grange and Mereside, with the same weekly progression drop-in.',
    evidence:
      'The existing two-team model is now in its second year under Wrenfield funding. Of 118 young people worked with intensively, 79 have moved into education, training or employment. Blackpool Council has confirmed it will fund one post from 2027.',
    sustainability:
      'Council match funding for one of the three posts is confirmed from April 2027; we are seeking the remainder from the police and crime commissioner.',
    partners: 'Blackpool Council, Lancashire Violence Reduction Network.',
    budget: [
      { item: 'Detached youth workers (2 FTE, 3 years)', amount: 118_000 },
      { item: 'Sessional workers', amount: 14_000 },
      { item: 'Training and safeguarding', amount: 4_800 },
      { item: 'Transport and equipment', amount: 6_400 },
    ],
  },
  {
    ref: 'WF-2026-008',
    org: 'fairstart',
    programme: 'youth',
    round: 'summer26',
    amount: 54_000,
    impact: 180,
    submittedDaysAgo: 35,
    outcome: 'shortlisted',
    project: 'Sector-based work academies for young people in Hull',
    need: 'Hull has a growing offshore wind and port logistics sector recruiting at pace, and a youth unemployment rate well above the regional average. The two facts do not currently meet: employers recruit at 21+, and young people have no route into the entry roles that exist.',
    approach:
      'Six-week pre-employment academies co-designed with four named employers, each ending in a guaranteed interview, plus twelve months of in-work support after placement — which is where most youth employment programmes stop and most young people fall out.',
    evidence:
      'Our 2024 pilot with two employers placed 34 of 51 participants; 28 were still in post at twelve months. The in-work support element is what the employers say made the difference.',
    sustainability:
      'Two employers have agreed to pay a placement fee from year two, which would cover roughly a third of delivery.',
    partners: 'Four named employers, Hull College, DWP Youth Hub.',
    budget: [
      { item: 'Academy delivery staff (2 FTE, 3 years)', amount: 108_000 },
      { item: 'In-work support worker (1 FTE)', amount: 42_000 },
      { item: 'Participant travel and kit', amount: 11_000 },
      { item: 'Employer liaison', amount: 6_000 },
    ],
  },
  {
    ref: 'WF-2026-014',
    org: 'cadence',
    programme: 'youth',
    round: 'summer26',
    amount: 41_000,
    impact: 300,
    submittedDaysAgo: 31,
    outcome: 'shortlisted',
    project: 'Music mentoring in Bradford pupil referral units',
    need: 'Bradford has three pupil referral units with no arts provision at all. Music is one of the few things that reliably gets a disengaged fourteen-year-old through a door.',
    approach:
      'Weekly music mentoring in all three PRUs delivered by working musicians, with a clear progression route into our studio sessions and, for some, into college music courses.',
    evidence:
      'We ran this in one PRU last year with a small grant. Attendance at the music session averaged 82% against a whole-timetable average of 54% for the same pupils. Eleven of thirty went on to enrol at our studio.',
    sustainability:
      'We are negotiating with the PRUs to fund sessions from their pupil premium allocation from year three.',
    partners: 'Three Bradford pupil referral units, Bradford College.',
    budget: [
      { item: 'Musician-mentors (sessional, 3 years)', amount: 63_000 },
      { item: 'Coordinator (0.4 FTE)', amount: 21_000 },
      { item: 'Instruments and equipment', amount: 8_500 },
    ],
  },
  {
    ref: 'WF-2026-021',
    org: 'lighthouse',
    programme: 'youth',
    round: 'summer26',
    amount: 58_000,
    impact: 700,
    submittedDaysAgo: 22,
    outcome: 'for_review',
    project: 'Youth provision across Knowsley',
    need: 'Young people in Knowsley continue to face barriers to opportunity and there remains a shortage of youth provision across the borough.',
    approach:
      'A borough-wide programme of youth activities delivered through our venue network, including sports, arts and personal development.',
    evidence:
      'We are a long-established organisation with extensive reach and strong relationships with local schools.',
    sustainability: 'We will continue to diversify our income base.',
    budget: [
      { item: 'Staff costs', amount: 44_000 },
      { item: 'Activities and materials', amount: 9_500 },
      { item: 'Venue costs', amount: 4_500 },
    ],
  },
  {
    ref: 'WF-2026-027',
    org: 'ropewalk',
    programme: 'youth',
    round: 'summer26',
    amount: 35_000,
    impact: 200,
    submittedDaysAgo: 14,
    outcome: 'for_review',
    project: 'Weekend opening at The Ropewalk',
    need: 'There is nothing open for young people in this part of Nottingham at weekends. Our own young people have asked for weekend opening at every consultation we have run since 2021.',
    approach:
      'Staffed Saturday and Sunday afternoon sessions with a programme shaped by the young people themselves — currently sport, cooking and a small recording set-up — plus a youth worker available for one-to-one conversations.',
    evidence:
      'We see around 90 young people a week across three evenings. Six trial weekend sessions last summer averaged 41 attendances, of whom 14 had never used the centre on a weekday.',
    sustainability:
      'We are applying to the National Lottery Community Fund for years three to five.',
    budget: [
      { item: 'Youth workers (weekend sessions, 2 years)', amount: 38_000 },
      { item: 'Activity programme', amount: 6_500 },
      { item: 'Additional insurance and utilities', amount: 3_200 },
    ],
  },

  {
    ref: 'WF-2026-005',
    org: 'threshold',
    programme: 'homes',
    round: 'summer26',
    amount: 48_000,
    impact: 420,
    submittedDaysAgo: 37,
    outcome: 'shortlisted',
    project: 'Extending cold homes advocacy to Merthyr and Caerphilly',
    need: 'The housing stock and the landlord behaviour we deal with in the Rhondda are identical one valley east, but there is no equivalent advocacy service in Merthyr Tydfil or Caerphilly.',
    approach:
      'Two additional advocates covering the two boroughs, running the same casework model: damp and mould reports, HHSRS referrals, and tribunal representation where a landlord retaliates.',
    evidence:
      'Under the current Wrenfield grant we have taken 268 cases in the Rhondda, secured works in 121, and successfully defended 14 of 16 retaliatory evictions. Welsh Government has cited the model in its private rented sector review.',
    sustainability:
      'Both councils have expressed interest in commissioning from 2028; neither will commit before seeing local outcomes.',
    partners: 'Shelter Cymru, Merthyr Tydfil CBC, Caerphilly CBC.',
    budget: [
      { item: 'Housing advocates (2 FTE, 2 years)', amount: 72_000 },
      { item: 'Tribunal and legal costs', amount: 8_000 },
      { item: 'Survey equipment', amount: 3_400 },
    ],
  },
  {
    ref: 'WF-2026-011',
    org: 'hearth',
    programme: 'homes',
    round: 'summer26',
    amount: 45_000,
    impact: 350,
    submittedDaysAgo: 33,
    outcome: 'shortlisted',
    project: 'From vouchers to casework: rebuilding the Hearth advice service',
    need: 'We ran a fuel voucher scheme for three winters and our own evaluation showed what the panel told us last year — a voucher relieves a fortnight and changes nothing. 61% of households we helped in 2023 were back the following winter.',
    approach:
      'Replace the voucher scheme entirely with two qualified energy advisers doing full casework: benefit checks, supplier negotiation, debt write-off applications and Priority Services registration, with a small hardship fund attached to a case rather than issued alone.',
    evidence:
      'We are a new entrant to casework and are honest about that. We have recruited an adviser from Citizens Advice Glasgow to lead it, and have commissioned Energy Action Scotland to review our case files quarterly.',
    sustainability:
      'Scottish Government fuel poverty funding is open to accredited advice services; accreditation requires two years of casework history, which this grant would build.',
    partners: 'Energy Action Scotland, Glasgow City Council.',
    budget: [
      { item: 'Energy advisers (2 FTE, 2 years)', amount: 84_000 },
      { item: 'Accreditation and quality review', amount: 7_500 },
      { item: 'Case-linked hardship fund', amount: 9_000 },
    ],
  },
  {
    ref: 'WF-2026-017',
    org: 'warmer',
    programme: 'homes',
    round: 'summer26',
    amount: 50_000,
    impact: 560,
    submittedDaysAgo: 27,
    outcome: 'for_review',
    project: 'Fuel debt casework: second phase',
    need: 'Demand for our casework service has grown 40% year on year and we are now turning away roughly a third of referrals. Average fuel debt among households we see is £1,610.',
    approach:
      'Two additional caseworkers and a supervisor, taking the team to five, plus a dedicated line for referrals from the two acute hospital discharge teams.',
    evidence:
      'Under the current grant we closed 1,140 cases, wrote off or rescheduled £890,000 of fuel debt and secured £520,000 in unclaimed benefit income. Median resolution 41 days.',
    sustainability:
      'Northern Powergrid now funds two posts. We expect to reach roughly half statutory and utility funding by 2029.',
    partners: 'Northern Powergrid, Sunderland City Council, South Tyneside NHS Trust.',
    budget: [
      { item: 'Caseworkers (2 FTE, 2 years)', amount: 66_000 },
      { item: 'Supervisor (0.5 FTE)', amount: 24_000 },
      { item: 'Crisis fund', amount: 10_000 },
    ],
  },
  {
    ref: 'WF-2026-023',
    org: 'newbridge',
    programme: 'homes',
    round: 'summer26',
    amount: 38_500,
    impact: 260,
    submittedDaysAgo: 19,
    outcome: 'for_review',
    project: 'Private tenant advice for west Belfast',
    need: 'Northern Ireland has no equivalent of the Renters Reform Act and tenants here can still be evicted without reason. West Belfast has the highest concentration of private rented housing in the city and no independent tenant advice at all.',
    approach:
      'A full-time adviser running drop-ins at three community venues plus a phone line, focusing on disrepair, deposit disputes and notice-to-quit challenges.',
    evidence:
      'Our volunteers handled 190 informal enquiries last year with no advertising. We have not run a formal advice service before and have budgeted for NICVA accreditation accordingly.',
    sustainability:
      'The Housing Executive has a small grants programme we would be eligible for after two years of operation.',
    budget: [
      { item: 'Adviser (1 FTE, 2 years)', amount: 34_000 },
      { item: 'Accreditation and supervision', amount: 5_600 },
      { item: 'Venue and telephone', amount: 3_800 },
    ],
  },
  {
    ref: 'WF-2026-030',
    org: 'shelteredlives',
    programme: 'homes',
    round: 'summer26',
    amount: 47_000,
    impact: 320,
    submittedDaysAgo: 11,
    outcome: 'declined',
    project: 'Retrofit advice service',
    need: 'Older homeowners in Leeds continue to live in cold, poorly insulated homes and find the retrofit market difficult to navigate.',
    approach:
      'An independent advice service for older owner-occupiers considering energy efficiency improvements.',
    evidence:
      'Our earlier pilot reached 40 households. We have not yet been able to evidence conversion into installed measures.',
    sustainability: 'Under discussion with Leeds City Council.',
    budget: [
      { item: 'Advisers (1.5 FTE)', amount: 43_000 },
      { item: 'Accreditation', amount: 4_000 },
    ],
  },

  {
    ref: 'WF-2026-006',
    org: 'chalkstreams',
    programme: 'rivers',
    round: 'summer26',
    amount: 72_000,
    impact: 58,
    submittedDaysAgo: 36,
    outcome: 'shortlisted',
    project: 'Wensum phase two: 58 hectares and a catchment nutrient plan',
    need: 'Phase one reconnected the floodplain but the phosphate load entering from the Blackwater tributary is unchanged, and without addressing it the ecological gain is capped.',
    approach:
      'Constructed wetlands on three tributary inflows to strip phosphate before it reaches the main channel, plus 58 hectares of floodplain reconnection on the next reach downstream. Anglian Water is contributing to the wetland element under its water industry national environment programme.',
    evidence:
      'Phase one is complete and monitored: invertebrate index up 29% after eighteen months, and the reconnected floodplain held water through both winter spates. Full monitoring data submitted with this application.',
    sustainability:
      'Anglian Water maintains the constructed wetlands under a 25-year agreement; the floodplain enters Countryside Stewardship.',
    partners: 'Anglian Water, Environment Agency, Norfolk Rivers Trust, five landowners.',
    budget: [
      { item: 'Constructed wetlands (3 inflows)', amount: 61_000 },
      { item: 'Floodplain reconnection earthworks', amount: 44_000 },
      { item: 'Consenting and ecological survey', amount: 12_000 },
      { item: 'Monitoring (5 years)', amount: 16_000 },
    ],
  },
  {
    ref: 'WF-2026-013',
    org: 'riverkeepers',
    programme: 'rivers',
    round: 'summer26',
    amount: 66_000,
    impact: 44,
    submittedDaysAgo: 32,
    outcome: 'shortlisted',
    project: 'Taff headwaters: mine water and riparian restoration',
    need: 'The Taff headwaters above Merthyr carry metal contamination from abandoned coal workings, and the riparian zone was cleared for opencast restoration in the 1990s and never replanted. Fish populations upstream of Cefn Coed remain functionally absent.',
    approach:
      'Two passive mine-water treatment systems at the worst two discharges, plus 8km of riparian replanting with a local school and volunteer programme attached to the maintenance.',
    evidence:
      'We delivered a comparable passive treatment scheme on the Nant Morlais in 2022. Zinc concentrations downstream fell by 71% and brown trout were recorded above the discharge for the first time in the survey record.',
    sustainability:
      'The Coal Authority has agreed to adopt maintenance of both treatment systems on completion.',
    partners: 'The Coal Authority, Natural Resources Wales, Merthyr Tydfil CBC.',
    budget: [
      { item: 'Passive treatment systems (2)', amount: 78_000 },
      { item: 'Riparian planting (8km)', amount: 21_000 },
      { item: 'Water quality monitoring', amount: 9_500 },
      { item: 'Volunteer coordination', amount: 7_000 },
    ],
  },
  {
    ref: 'WF-2026-019',
    org: 'peatland',
    programme: 'rivers',
    round: 'summer26',
    amount: 74_000,
    impact: 210,
    submittedDaysAgo: 25,
    outcome: 'for_review',
    project: 'Blanket bog restoration, Strath Halladale',
    need: 'Around 210 hectares of blanket bog in Strath Halladale remain gullied and actively eroding, delivering peat sediment into a salmon river and emitting an estimated 1,900 tonnes CO₂e a year.',
    approach:
      'Ditch blocking, hagg reprofiling and bare-peat revegetation across the site, with fixed-point photography and dipwell monitoring on a five-year cycle.',
    evidence:
      'We have restored 1,240 hectares since 2018 under Peatland ACTION. Water table depth on our 2019 sites has recovered to within 10cm of surface across 80% of monitored points.',
    sustainability:
      'The estate has entered the site into the Peatland Code, which funds twenty-five years of monitoring and remediation.',
    partners: 'NatureScot Peatland ACTION, Halladale Estate, Fisheries Management Scotland.',
    budget: [
      { item: 'Ditch blocking and reprofiling', amount: 82_000 },
      { item: 'Bare peat revegetation', amount: 24_000 },
      { item: 'Monitoring installation', amount: 11_000 },
    ],
  },
  {
    ref: 'WF-2026-026',
    org: 'upperdales',
    programme: 'rivers',
    round: 'summer26',
    amount: 58_000,
    impact: 35,
    submittedDaysAgo: 16,
    outcome: 'declined',
    project: 'Swale catchment partnership',
    need: 'Diffuse pollution and habitat degradation continue to affect the River Swale.',
    approach:
      'Continued farmer engagement and habitat improvement works at sites to be identified.',
    evidence:
      'We have good relationships across the catchment and have delivered similar programmes.',
    sustainability: 'Landowners will maintain the works.',
    omit: ['budget', 'impact'],
  },

  {
    ref: 'WF-2026-009',
    org: 'larder',
    programme: 'food',
    round: 'summer26',
    amount: 40_000,
    impact: 58_000,
    submittedDaysAgo: 34,
    outcome: 'shortlisted',
    project: 'Pantry network phase two: three further sites and a shared warehouse',
    need: 'The three converted pantries are at capacity with waiting lists at all three. Our constraint is now storage — we are turning down surplus food because we have nowhere to put it.',
    approach:
      'Convert three further parcel sites and lease a small warehouse with chilled storage, which also lets us take pallet-scale surplus that currently goes to two other regions.',
    evidence:
      'The first three conversions are complete under the current Wrenfield grant: 940 member households, 74% active at six months, and membership fees now covering 51% of running costs. Referrals into debt advice are up sixfold.',
    sustainability:
      'At six sites, membership income covers around 60% of running costs. The warehouse pays for itself in reduced per-site delivery.',
    partners: 'Your Local Pantry, FareShare Greater Manchester, Oldham Council.',
    budget: [
      { item: 'Site conversions (3)', amount: 24_000 },
      { item: 'Warehouse lease and chilled storage (2 years)', amount: 31_000 },
      { item: 'Logistics coordinator (1 FTE)', amount: 29_000 },
    ],
  },
  {
    ref: 'WF-2026-015',
    org: 'secondharvest',
    programme: 'food',
    round: 'summer26',
    amount: 38_000,
    impact: 46_000,
    submittedDaysAgo: 29,
    outcome: 'shortlisted',
    project: 'Plymouth community kitchen: meals from surplus at scale',
    need: 'Plymouth has substantial food surplus reaching the city and no central kitchen able to process it. Fresh produce that arrives on a Friday is largely wasted because no single project can use it.',
    approach:
      'A commercial-standard community kitchen cooking surplus into frozen meals for distribution through fourteen existing projects, staffed by a chef and a rolling cohort of trainees working towards a food hygiene qualification.',
    evidence:
      'We have run a smaller version from a hired church kitchen for two years, producing about 900 meals a month. Fourteen partner projects already take our output and all have asked for more than we can supply.',
    sustainability:
      'We will sell a proportion of output to two workplace canteens at cost-plus, which we project will cover around 40% of running costs by year three.',
    partners: 'FareShare South West, Plymouth City Council, fourteen partner projects.',
    budget: [
      { item: 'Kitchen fit-out and blast chiller', amount: 42_000 },
      { item: 'Chef and kitchen assistant (2 years)', amount: 61_000 },
      { item: 'Trainee programme', amount: 8_500 },
      { item: 'Distribution', amount: 6_000 },
    ],
  },
  {
    ref: 'WF-2026-022',
    org: 'fenland',
    programme: 'food',
    round: 'summer26',
    amount: 33_000,
    impact: 21_000,
    submittedDaysAgo: 20,
    outcome: 'for_review',
    project: 'North east Lincolnshire food network',
    need: 'Fourteen food projects in Grimsby and Cleethorpes still operate with no shared referral route, and three have closed in the past year without their users being picked up elsewhere.',
    approach:
      'A coordinator to run a shared referral system and a surplus-sharing rota, plus a small resilience fund to keep a project open while it finds new funding.',
    evidence:
      'Twelve of the fourteen projects attended our convening meeting and ten have signed a memorandum of understanding. We have not run a coordination function before.',
    sustainability:
      'Member projects have agreed in principle to contribute to the coordinator post from year three.',
    budget: [
      { item: 'Network coordinator (1 FTE, 2 years)', amount: 56_000 },
      { item: 'Shared referral system', amount: 4_500 },
      { item: 'Resilience fund', amount: 8_000 },
    ],
  },
  {
    ref: 'WF-2026-028',
    org: 'breadoven',
    programme: 'food',
    round: 'summer26',
    amount: 30_000,
    impact: 11_000,
    submittedDaysAgo: 12,
    outcome: 'declined',
    project: 'Bakery training expansion',
    need: 'Long-term unemployment in Camborne remains high and our bakery course is oversubscribed.',
    approach: 'Run four cohorts a year instead of two, with an additional tutor.',
    evidence:
      'Previous cohorts had good attendance, though we have not systematically tracked what happened to participants afterwards.',
    sustainability: 'Bakery sales contribute to running costs.',
    budgetLink: 'https://wrenfield.example/uploads/breadoven-budget-2026.xlsx',
  },
]

/** The one submission deliberately left stuck in the admin review queue. It names a
 *  programme the foundation does not run, so the pipeline cannot resolve a round
 *  programme and holds it — the `programme_unknown` blocker, with a real row behind it. */
export const HELD_SUBMISSION = {
  ref: 'WF-2026-031',
  org: 'growing',
  programmeName: 'Green Spaces',
  amount: 26_000,
  project: 'Community orchard and growing space, Walsall',
}
