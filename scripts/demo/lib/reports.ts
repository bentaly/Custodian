// ─── Demo dataset: the grant reports ─────────────────────────────────────────
//
// What each grantee sent back. These go through the real report pipeline, so the
// summary, the alignment scores and the extracted impact quantity are all produced by
// the model from this text — none of it is written here.
//
// The set is written to span what actually comes back from grantees. Most report
// solid delivery. One (`WF-2025-025`) reports a project that under-delivered against
// what it promised, and says so; that is the case the application-alignment feature
// exists for, and a demo where every report is glowing never shows it working.
//
// `beneficiaryCount` is only supplied where the programme measures impact in people
// or households — a charity-typed count beats AI extraction, and that is the path
// worth showing. Where the unit is hectares or meals, the quantity is left in the
// narrative for the model to find.

export interface DemoReport {
  /** The ORIGINAL application's reference — this is what links a report to its grant. */
  ref: string
  contactName: string
  submittedDaysAgo: number
  grantTitle: string
  impactSummary: string
  challenges: string
  lessons: string
  caseStudy?: string
  testimonial?: string
  beneficiaryCount?: number
  deliveryArea: string
}

export const REPORTS: DemoReport[] = [
  {
    ref: 'WF-2025-004',
    contactName: 'Dawn Hollis',
    submittedDaysAgo: 118,
    grantTitle: 'Detached youth work on the Grange and Mereside estates',
    beneficiaryCount: 127,
    deliveryArea: 'Blackpool',
    impactSummary:
      'Both detached teams have been running four evenings a week since the grant started. We have ' +
      'worked with 127 young people across the two estates, of whom 68 have engaged repeatedly ' +
      'enough for us to count them as sustained relationships. Forty-one have come through to the ' +
      'weekly progression drop-in, and 29 have moved into education, training or employment — 22 of ' +
      'those were still in place at the six-month follow-up. The Mereside team took longer to ' +
      'establish than we projected because the young people there had been let down by two ' +
      'previous short-term projects and were slow to trust another one; that is now the stronger ' +
      'of the two sites. Blackpool Council has confirmed in writing that it will fund one worker ' +
      'post from April 2027.',
    challenges:
      'Recruitment was the main difficulty. We lost eight weeks at the start looking for the second ' +
      'detached worker and eventually appointed at a slightly higher salary point than budgeted, ' +
      'which we absorbed by reducing sessional hours. We also had a safeguarding incident in month ' +
      'four involving a young person outside our age range, which we reported to the LADO and which ' +
      'was closed with no action; it did lead us to tighten our lone-working protocol.',
    lessons:
      'The biggest lesson is about pace on estates that have had provision withdrawn before. We ' +
      'planned for a six-week engagement period on Mereside and it took closer to five months. We ' +
      'would now build that into the design rather than treating it as a delay. We have also ' +
      'stopped counting attendance as a measure internally — it told us nothing useful compared to ' +
      'the number of young people with a named worker they will actually ring.',
    caseStudy:
      'One young person, 16, had been out of education for eleven months and was on a youth ' +
      'caution. He met our worker on the street in October and did not engage beyond a conversation ' +
      'for about three months. He now attends the drop-in weekly, has completed a CSCS card, and ' +
      'started a groundworks apprenticeship in June.',
    testimonial:
      '"They actually turn up. Everyone else says they will and then the funding stops." — young ' +
      'person, Grange estate',
  },
  {
    ref: 'WF-2025-011',
    contactName: 'Steven Marr',
    submittedDaysAgo: 108,
    grantTitle: 'Transitions: supported college entry for care-experienced young people',
    beneficiaryCount: 46,
    deliveryArea: 'Middlesbrough',
    impactSummary:
      'We supported 46 care-experienced young people through the application and enrolment process ' +
      'this year, against a target of 40. Thirty-eight enrolled at Middlesbrough College or ' +
      'Redcar & Cleveland College in September and 33 completed the first year — a retention rate ' +
      'of 87% against a local baseline for care-experienced learners of around 52%. The named-worker ' +
      'model is what does it: the young people who dropped out were the two we were unable to ' +
      'allocate a consistent worker to after a staff resignation in February.',
    challenges:
      'The staff resignation in February cost us continuity for nine young people for about six ' +
      'weeks. We covered the caseload between the remaining workers but it was too thin, and two ' +
      'of the three withdrawals came from that group. We have since built in a named second contact ' +
      'for every young person so a departure does not sever the relationship entirely.',
    lessons:
      'Starting in March rather than at enrolment is the single thing that makes this work — by ' +
      'September the relationship already exists. We also found the bursary paperwork was a bigger ' +
      'barrier than the application itself; we now do it alongside the young person rather than ' +
      'signposting them to it.',
    testimonial:
      '"I would have dropped out in the first month. She rang me every week whether I answered or ' +
      'not." — first-year learner',
  },
  {
    ref: 'WF-2025-023',
    contactName: 'Amara Nwosu',
    submittedDaysAgo: 42,
    grantTitle: 'Peer mentoring for young people excluded from mainstream school',
    beneficiaryCount: 88,
    deliveryArea: 'Birmingham',
    impactSummary:
      'Eighty-eight young people were matched with a mentor over the year across four alternative ' +
      'provision settings. Sixty-four completed the full nine months. At exit, 51 were in ' +
      'education, employment or training. The mentors themselves remain the strongest part of the ' +
      'model — all fourteen were excluded from school themselves, and the young people tell us ' +
      'repeatedly that this is why they listen. Two of our mentors have this year moved into ' +
      'full-time youth work roles elsewhere, which we count as a success even though it cost us ' +
      'the mentors.',
    challenges:
      'Mentor supervision was under-resourced in our original budget. Fortnightly paid supervision ' +
      'turned out to be the minimum viable, not a comfortable level, and we have had to move money ' +
      'from the training line to sustain it. One mentor withdrew mid-placement following a personal ' +
      'bereavement and the young person was re-matched, which set that relationship back to the ' +
      'beginning.',
    lessons:
      'Nine months with a clear ending works better than an open-ended relationship. We trialled ' +
      'four open-ended matches and all four drifted. The exit plan is not administrative tidiness — ' +
      'it is what makes the relationship purposeful.',
    caseStudy:
      'A 15-year-old permanently excluded for persistent disruption was matched with a mentor who ' +
      'had been excluded from the same school a decade earlier. She re-engaged with maths and ' +
      'English, sat two GCSEs in the summer and is now at college on a level 2 course.',
  },
  {
    ref: 'WF-2025-007',
    contactName: 'Julie Fenwick',
    submittedDaysAgo: 126,
    grantTitle: 'Fuel debt casework across Sunderland',
    beneficiaryCount: 604,
    deliveryArea: 'Sunderland',
    impactSummary:
      'The three caseworkers closed 604 cases in the first year of the grant. We wrote off or ' +
      'rescheduled £498,000 of fuel debt and secured £287,000 in previously unclaimed benefit ' +
      'income for the households we worked with. Median time to resolution was 44 days, broadly in ' +
      'line with the 46 days we reported at application. The proportion of cases arriving via GP ' +
      'referral has risen from 8% to 21% over the year, which we take as evidence the referral ' +
      'route is bedding in.',
    challenges:
      'Two suppliers substantially slowed their response times over the winter, which pushed our ' +
      'median resolution time up to 61 days between December and February before recovering. We ' +
      'escalated eleven cases to the Energy Ombudsman, of which nine were upheld. We also ' +
      'underestimated how many households would need a second intervention within the year — about ' +
      'one in seven came back, usually because a benefit change was not carried through by DWP.',
    lessons:
      'A voucher alone genuinely does not work — of the households referred to us who had ' +
      'previously received vouchers elsewhere, 58% were in the same or worse debt position a year ' +
      'later. We have used our own data on this to persuade two partner agencies to switch to ' +
      'referring into casework rather than issuing vouchers.',
    testimonial:
      '"I had £2,300 of debt and a prepayment meter I could not afford to feed. They got the debt ' +
      'written off and my meter changed. I have not been cold since." — client, Hendon',
  },
  {
    ref: 'WF-2025-014',
    contactName: 'Rhian Probert',
    submittedDaysAgo: 96,
    grantTitle: 'Cold homes advocacy in the Rhondda valleys',
    beneficiaryCount: 268,
    deliveryArea: 'Rhondda Cynon Taf',
    impactSummary:
      'We took 268 cold-homes cases in the first year. Works were carried out in 121 properties, ' +
      'ranging from a boiler repair to full damp remediation. Thirty-four cases went to the council ' +
      'as formal HHSRS complaints, of which 22 resulted in an improvement notice. We defended ' +
      'sixteen retaliatory eviction attempts and successfully resisted fourteen. Welsh Government ' +
      'cited our casework in its private rented sector review evidence session in March.',
    challenges:
      'Landlord retaliation is more common than we projected — we budgeted for eight tribunal ' +
      'defences and ran sixteen, which exhausted the legal costs line by month nine. We have met ' +
      'the shortfall from reserves and are seeking a specific legal fund for next year. The other ' +
      'difficulty is that a successful HHSRS notice does not always produce works; four landlords ' +
      'have simply sold the property with the tenant still in place.',
    lessons:
      'Tenants come to us far later than they should, typically after a year of damp. The referral ' +
      'route that works best is health visitors, not the council — we have redirected our outreach ' +
      'accordingly.',
  },
  {
    ref: 'WF-2025-041',
    contactName: 'Gary Sheldon',
    submittedDaysAgo: 26,
    grantTitle: 'Energy advice in the former coalfield villages of Rotherham',
    beneficiaryCount: 391,
    deliveryArea: 'Rotherham',
    impactSummary:
      'The mobile service has now visited all nine villages weekly for a full year and advised 391 ' +
      'households. Verified annual savings averaged £392 per household at the six-month follow-up ' +
      'call, giving roughly £153,000 of household income protected across the cohort. We referred ' +
      '84 households into the council retrofit scheme, of which 51 have had measures installed. ' +
      'Rotherham MBC has agreed to fund the rota for the six new villages from April, which was the ' +
      'sustainability outcome we set out at application.',
    challenges:
      'The van needed an unplanned gearbox replacement in month seven which took the service off ' +
      'the road for three weeks. We ran a reduced service from village halls in the interim but ' +
      'attendance dropped sharply — the van itself turns out to be a significant part of why people ' +
      'come. We have budgeted a vehicle contingency for next year.',
    lessons:
      'Fixed weekly timing matters more than we appreciated. In the two villages where we varied ' +
      'the day to fit around other commitments, attendance was roughly half that of the villages ' +
      'with an unchanging slot.',
  },
  {
    ref: 'WF-2025-009',
    contactName: 'Dr Eleanor Vance',
    submittedDaysAgo: 112,
    grantTitle: 'Restoring the upper Wensum: floodplain reconnection',
    deliveryArea: 'Norfolk',
    impactSummary:
      'The scheme is complete. We removed 1.8km of embankment, re-meandered the channel through its ' +
      'historic course, and have reconnected 46 hectares of floodplain grazing marsh — the full ' +
      'area set out at application. All three landowners signed twenty-year Countryside Stewardship ' +
      'agreements before the second instalment was drawn down, as the grant conditions required. ' +
      'First-year monitoring shows the reconnected floodplain inundated on four occasions over the ' +
      'winter, which is what the hydraulic modelling predicted. Invertebrate sampling at the ' +
      'downstream site shows a 19% rise in the community index against baseline; we would caution ' +
      'that one year is too early to read much into that figure.',
    challenges:
      'Consenting took five months against the three we allowed, largely because the flood risk ' +
      'activity permit had to be revised after the Environment Agency changed its position on spoil ' +
      'placement. That pushed the earthworks into a wetter window than ideal and we lost eleven ' +
      'working days to ground conditions. The contractor absorbed most of the cost under a fixed ' +
      'price.',
    lessons:
      'Build five months of consenting into any scheme involving a flood risk activity permit, not ' +
      'three. We would also start the landowner stewardship applications in parallel with ' +
      'consenting rather than sequentially — doing them in series was the main reason the second ' +
      'instalment was drawn later than planned.',
  },
  // The under-delivery case. Reported honestly, which is what makes it useful: the
  // alignment analysis has genuine unmet promises to find, and the grant is one an
  // admin would actually want to talk to the grantee about.
  {
    ref: 'WF-2025-012',
    contactName: 'Michelle Okafor',
    submittedDaysAgo: 102,
    grantTitle: 'The Larder pantry network: from parcels to membership',
    deliveryArea: 'Oldham',
    impactSummary:
      'We converted two of the three sites set out at application. The Chadderton and Royton ' +
      'pantries opened in month three and month six respectively and between them have 610 member ' +
      'households, providing the equivalent of approximately 31,000 meals and food parcels over the ' +
      'period. Retention at six months is 74%, close to the 78% we reported from Failsworth. ' +
      'Referrals into our debt advice service are up fourfold as projected. The third site, at ' +
      'Werneth, has not opened: the premises we had agreed fell through in month five when the ' +
      'landlord withdrew, and the two alternatives we have looked at since have both needed more ' +
      'electrical work than the conversion budget allows.',
    challenges:
      'Losing the Werneth premises is the substantial failure of the year and we want to be clear ' +
      'about it rather than bury it. We have around £7,000 of the conversion budget unspent as a ' +
      'result and would like to discuss with you whether to hold it for a fourth site or return it. ' +
      'Refrigeration costs also came in about 20% above budget across both sites, which we met by ' +
      'reducing the coordinator post from full-time to 0.8 FTE for the first six months.',
    lessons:
      'We should not have counted on a single premises option per site. For any future conversion ' +
      'we will have a second option identified before we commit the budget line. The membership ' +
      'model itself has held up well — members are staying longer than the parcel model ever ' +
      'achieved, and the shame factor that drove people away from parcels genuinely does not seem ' +
      'to operate in the same way when people are paying and choosing.',
    testimonial:
      '"It feels like shopping. That sounds like a small thing and it is not." — pantry member, ' +
      'Chadderton',
  },
]
