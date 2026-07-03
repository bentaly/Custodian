import { useState } from 'react'
import { API_BASE } from './api'

// ─── 7stars foundation "Social Impact" test submitter ────────────────────────
//
// Simulates the real the7stars foundation Social Impact application form
// (https://the7starsfoundation.co.uk/apply-for-funding/social-impact) posting
// into /api/apply the way a Gravity Forms → webhook integration would: the
// payload keys are the form's own field labels, verbatim, plus the "Entry Id"
// Gravity assigns each submission. File-upload and consent fields are omitted.
//
// Expected mapping outcomes (per the common dictionary in
// src/lib/fieldMapping/common.ts):
//  - auto-mapped: Organisation name, Your bank's name / account name / account
//    number / sort code, Entry Id (→ externalApplicationId), programmeName
//  - needs AI/review: "How much funding are you requesting from the7stars
//    foundation?" (required amountRequested → ingest holds as needs_review /
//    ai_proposed), "Organisation registration number" (ambiguous charity vs
//    company number), "What is the post code of the delivery of your work?"
//    (deliveryArea)
// Resolving those in the Review queue (and saving the mappings) makes the next
// submission land as `complete` — that round-trip is the point of this test.

const REGIONS = [
  'North East', 'North West', 'Yorkshire and the Humber', 'East Midlands',
  'West Midlands', 'East of England', 'London', 'South East', 'South West',
  'Wales', 'Scotland', 'Northern Ireland',
]

type SevenStarsFieldType = 'text' | 'textarea' | 'number' | 'select' | 'date'

interface SevenStarsField {
  /** Verbatim label from the live form — sent as the raw payload key. */
  key: string
  type: SevenStarsFieldType
  options?: string[]
  /** Expected mapping outcome, shown as a hint on the field. */
  expect?: string
  optional?: boolean
}

interface SevenStarsSection {
  title: string
  fields: SevenStarsField[]
}

const SECTIONS: SevenStarsSection[] = [
  {
    title: 'Contact details',
    fields: [
      { key: 'Contact name', type: 'text' },
      { key: 'Contact email', type: 'text' },
      { key: 'Contact phone no', type: 'text' },
    ],
  },
  {
    title: 'Organisation details',
    fields: [
      { key: 'Organisation type', type: 'select', options: ['Charity', "Council-run Children's Home", 'School in England'] },
      { key: 'Organisation name', type: 'text', expect: 'auto → organisationName' },
      { key: 'Organisation website', type: 'text' },
      { key: 'Organisation registration number', type: 'text', expect: 'review — ambiguous (charity vs company number)' },
      { key: 'Organisation registration date', type: 'date' },
      { key: "Your organisation's regulator", type: 'text' },
      { key: 'Provide a link to a video showcasing the work of your organisation and summarising your application (optional).', type: 'text', optional: true },
      { key: 'Please give details on your organisation’s main activities and services.', type: 'textarea' },
    ],
  },
  {
    title: 'Where you work',
    fields: [
      { key: 'In what region will your work be delivered?', type: 'select', options: REGIONS },
      { key: 'What is the post code of the delivery of your work?', type: 'text', expect: 'review → deliveryArea' },
      { key: 'In what region is your organisation based?', type: 'select', options: REGIONS },
      { key: "What is your organisation's specific location?", type: 'text' },
    ],
  },
  {
    title: 'Finances',
    fields: [
      { key: 'Your organisation’s total income in the last year.', type: 'number' },
      { key: 'Your organisation’s total expenditure in the last year.', type: 'number' },
      { key: 'Your organisation’s total salaries in the last year.', type: 'number' },
      { key: 'Your current unrestricted funding reserves.', type: 'number' },
      { key: 'Please provide narrative on your unrestricted funding reserve sources.', type: 'textarea' },
      { key: 'Your current restricted funding reserves.', type: 'number' },
      { key: 'Please provide narrative on your restricted funding reserve sources.', type: 'textarea' },
      { key: 'Your balance at the time of application.', type: 'number' },
      { key: "Your bank's name", type: 'text', expect: 'auto → bankName' },
      { key: 'Your bank account name', type: 'text', expect: 'auto → bankAccountName' },
      { key: 'Your bank account number', type: 'text', expect: 'auto → bankAccountNumber' },
      { key: 'Your bank sort code', type: 'text', expect: 'auto → bankSortCode' },
      { key: 'Full-time', type: 'number' },
      { key: 'Part-time', type: 'number' },
      { key: 'Volunteers', type: 'number' },
      { key: 'Trustees', type: 'number' },
    ],
  },
  {
    title: 'Your funding request',
    fields: [
      { key: 'Which fund focus area does your funding request primarily relate to?', type: 'select', options: ['Anti-Racism', 'Online Abuse'] },
      { key: 'Funding title', type: 'text' },
      { key: 'Does your funding request seek support for a solution or a cause (please provide narrative)?', type: 'textarea' },
      { key: 'Why is this funding needed and how has the need been identified?', type: 'textarea' },
      { key: 'How many young people will benefit from our funding?', type: 'number' },
      { key: 'Please give ages or age ranges of the young people who will benefit.', type: 'text' },
      { key: 'Please give details on your organisation’s expertise in this application’s subject matter.', type: 'textarea' },
      { key: 'Have you delivered work similar in nature to this application before?', type: 'select', options: ['Yes', 'No'] },
      { key: 'Please describe the challenges you encountered and your plans to address them if your application is successful.', type: 'textarea' },
    ],
  },
  {
    title: 'Budget',
    fields: [
      { key: 'How much funding are you requesting from the7stars foundation?', type: 'number', expect: 'review — required amountRequested, not in common dictionary' },
      { key: 'Do you have any other funding secured to date?', type: 'select', options: ['Yes', 'No'] },
      { key: 'If you have secured other funding, who was it from and for how much?', type: 'text', optional: true },
      { key: 'Please use the below to outline your budget for the funding you are requesting:', type: 'textarea' },
      { key: 'Any additional notes', type: 'textarea', optional: true },
      { key: 'Budget total', type: 'number' },
    ],
  },
]

// Three fictional applicants pitched at different Custodian-score bands, so the
// scorer's discrimination can be tested from one form. Each also carries a real
// charity register number giving a different due diligence outcome once the
// registration-number field is mapped (WARNING / BLOCKED / CLEAR respectively).

// Decent (~mid band): well aligned with the Online Abuse focus area and
// financially eligible, but a modest track record (pilot not yet evaluated),
// partly anecdotal evidence of need, and a vague contingency budget line.
// Registration number 219279 → due diligence WARNING (accounts overdue).
const PREFILL_DECENT: Record<string, string> = {
  'Contact name': 'Priya Shah',
  'Contact email': 'priya.shah@brightnetyouth.org.uk',
  'Contact phone no': '020 7946 0301',
  'Organisation type': 'Charity',
  'Organisation name': 'BrightNet Youth',
  'Organisation website': 'https://www.brightnetyouth.org.uk',
  'Organisation registration number': '219279',
  'Organisation registration date': '2014-03-12',
  "Your organisation's regulator": 'Charity Commission for England and Wales',
  'Please give details on your organisation’s main activities and services.':
    'BrightNet Youth supports young people aged 11–18 in east London to stay safe online and rebuild confidence after experiencing online harm. We run weekly digital-safety drop-ins in three partner secondary schools, a peer-mentor programme that trains older teenagers to support younger pupils, and one-to-one support sessions for young people referred by schools and social services following online abuse. We also deliver termly workshops for parents and carers.',
  'In what region will your work be delivered?': 'London',
  'What is the post code of the delivery of your work?': 'E17 6DS',
  'In what region is your organisation based?': 'London',
  "What is your organisation's specific location?": 'Waltham Forest',
  'Your organisation’s total income in the last year.': '412000',
  'Your organisation’s total expenditure in the last year.': '398500',
  'Your organisation’s total salaries in the last year.': '236000',
  'Your current unrestricted funding reserves.': '96000',
  'Please provide narrative on your unrestricted funding reserve sources.':
    'Our unrestricted reserves have been built from individual donations and Gift Aid over the past three years. Trustees hold a reserves policy of three months’ running costs; current reserves equate to roughly twelve weeks of expenditure.',
  'Your current restricted funding reserves.': '41500',
  'Please provide narrative on your restricted funding reserve sources.':
    'Restricted reserves relate to a BBC Children in Need grant contributing to youth worker salary costs and a small local authority contract for school workshops, both to be fully spent by March 2027.',
  'Your balance at the time of application.': '68400',
  "Your bank's name": 'CAF Bank',
  'Your bank account name': 'BrightNet Youth',
  'Your bank account number': '12345678',
  'Your bank sort code': '40-52-40',
  'Full-time': '6',
  'Part-time': '4',
  'Volunteers': '18',
  'Trustees': '7',
  'Which fund focus area does your funding request primarily relate to?': 'Online Abuse',
  'Funding title': 'Safer Feeds: peer-led support for young people experiencing online abuse',
  'Does your funding request seek support for a solution or a cause (please provide narrative)?':
    'Primarily a solution. Safer Feeds delivers direct, peer-led support to young people experiencing online abuse: trained peer mentors run small-group sessions in school, backed by our youth work team, so that young people can talk about group-chat pile-ons, image-based abuse and pressure to share content with someone their own age. We will also contribute to the wider cause by sharing anonymised insight with the local safeguarding partnership, though our capacity for policy work is limited.',
  'Why is this funding needed and how has the need been identified?':
    'Referrals to our one-to-one service relating to online abuse have more than doubled in the past 18 months, from 31 to 74. Teachers in our partner schools tell us group-chat pile-ons and image-based abuse are the most common issues they now see. We surveyed 68 young people at our drop-ins in autumn 2025: 71% said they had experienced or witnessed abusive behaviour online in the previous month, and most said they would rather talk to another young person than to an adult. We have not yet been able to commission an independent needs assessment.',
  'How many young people will benefit from our funding?': '150',
  'Please give ages or age ranges of the young people who will benefit.': '11–18, with most participants aged 13–16',
  'Please give details on your organisation’s expertise in this application’s subject matter.':
    'Our youth work team holds NSPCC online-safety training and our programme lead spent six years in a school safeguarding role before joining us. We have delivered digital-safety workshops since 2021 and launched the peer-mentor pilot in January 2025, training twelve mentors to date. An external evaluation of the pilot is planned but has not yet been commissioned.',
  'Have you delivered work similar in nature to this application before?': 'Yes',
  'Please describe the challenges you encountered and your plans to address them if your application is successful.':
    'Recruiting and retaining peer mentors has been harder than expected: five of our first cohort of twelve stepped back within six months, mostly due to exam pressure. If funded, we will shorten mentor commitments to one term at a time, introduce a small recognition budget, and pair each mentor with a staff supervisor. Some schools have also been slow to refer; we plan to formalise referral agreements at the start of each academic year.',
  'How much funding are you requesting from the7stars foundation?': '10000',
  'Do you have any other funding secured to date?': 'Yes',
  'If you have secured other funding, who was it from and for how much?': 'BBC Children in Need — £24,000 over two years towards youth worker salary costs',
  'Please use the below to outline your budget for the funding you are requesting:':
    'Peer mentor training weekends (two per year) — £3,200\nYouth worker sessional hours (mentor supervision) — £4,400\nMentor recognition and expenses — £1,100\nMaterials, room hire and refreshments — £800\nContingency — £500',
  'Any additional notes': 'We are happy to share our safeguarding policy and pilot feedback summaries on request.',
  'Budget total': '10000',
}

// Weak (~low band): a well-meaning community group whose application barely
// engages with the focus area — adult-skewed audience, no evidence of need, no
// relevant track record, a vague events budget, unrestricted reserves at ~43%
// of income (breaching the foundation's 30% rule), and a personal-looking bank
// account name. Registration number 1068298 (Kids Company) → due diligence
// BLOCKED (removed from register) once mapped.
const PREFILL_WEAK: Record<string, string> = {
  'Contact name': 'Dave Prendergast',
  'Contact email': 'dave.p.communitygroup@gmail.com',
  'Contact phone no': '07700 900123',
  'Organisation type': 'Charity',
  'Organisation name': 'Positive Vibes Community Group',
  'Organisation website': 'https://www.facebook.com/positivevibescg',
  'Organisation registration number': '1068298',
  'Organisation registration date': '2019-08-01',
  "Your organisation's regulator": 'Charity Commission',
  'Please give details on your organisation’s main activities and services.':
    'We run activities for young people in the local area including football, music nights and day trips. We also put on other community events during the year which are open to everyone in the community.',
  'In what region will your work be delivered?': 'North West',
  'What is the post code of the delivery of your work?': 'M14 4PX',
  'In what region is your organisation based?': 'North West',
  "What is your organisation's specific location?": 'Manchester',
  'Your organisation’s total income in the last year.': '985000',
  'Your organisation’s total expenditure in the last year.': '610000',
  'Your organisation’s total salaries in the last year.': '180000',
  'Your current unrestricted funding reserves.': '420000',
  'Please provide narrative on your unrestricted funding reserve sources.':
    'General savings built up over the years.',
  'Your current restricted funding reserves.': '15000',
  'Please provide narrative on your restricted funding reserve sources.':
    'A grant we have not spent yet.',
  'Your balance at the time of application.': '435000',
  "Your bank's name": 'Barclays',
  'Your bank account name': 'D Prendergast',
  'Your bank account number': '87654321',
  'Your bank sort code': '20-00-00',
  'Full-time': '1',
  'Part-time': '0',
  'Volunteers': '3',
  'Trustees': '3',
  'Which fund focus area does your funding request primarily relate to?': 'Anti-Racism',
  'Funding title': 'Community Fun Days',
  'Does your funding request seek support for a solution or a cause (please provide narrative)?':
    'We want to run fun days to bring the community together. Racism is a problem so events like this help everyone get along better.',
  'Why is this funding needed and how has the need been identified?':
    'Everyone knows racism is an issue these days. We have not done a survey but we think there is a need for more community events in the area.',
  'How many young people will benefit from our funding?': '5000',
  'Please give ages or age ranges of the young people who will benefit.':
    'All ages welcome, mostly adults and some young people',
  'Please give details on your organisation’s expertise in this application’s subject matter.':
    'We have run events before and the committee has lived in the area a long time so we know the community well.',
  'Have you delivered work similar in nature to this application before?': 'No',
  'Please describe the challenges you encountered and your plans to address them if your application is successful.':
    'We do not expect any challenges.',
  'How much funding are you requesting from the7stars foundation?': '10000',
  'Do you have any other funding secured to date?': 'No',
  'If you have secured other funding, who was it from and for how much?': '',
  'Please use the below to outline your budget for the funding you are requesting:':
    'Stage and PA hire — £3,000\nFood and refreshments — £2,500\nEntertainment — £2,500\nMiscellaneous — £2,000',
  'Any additional notes': '',
  'Budget total': '10000',
}

// Strong (~high band): a long-established Glasgow anti-racism youth charity —
// tight strategic fit (under-18s, root causes, co-designed with young people),
// externally evaluated track record, evidenced need, healthy finances (~15%
// unrestricted reserves), secured match funding, and a budget split per year to
// match the £5,000-per-year grant structure. Registration number SC003558 →
// due diligence CLEAR (OSCR path) once mapped.
const PREFILL_STRONG: Record<string, string> = {
  'Contact name': 'Dr Nia Okafor',
  'Contact email': 'nia.okafor@amplifyyouth.org.uk',
  'Contact phone no': '0141 496 0072',
  'Organisation type': 'Charity',
  'Organisation name': 'Amplify Youth Trust',
  'Organisation website': 'https://www.amplifyyouth.org.uk',
  'Organisation registration number': 'SC003558',
  'Organisation registration date': '2011-05-16',
  "Your organisation's regulator": 'OSCR (Scottish Charity Regulator)',
  'Please give details on your organisation’s main activities and services.':
    'Amplify Youth Trust has worked with young people aged 12–18 experiencing racism in Glasgow since 2011. We deliver school-based anti-racism workshops, a youth-led ambassador programme, one-to-one mentoring for young people affected by racist incidents, and training for teachers and youth workers. All programmes are co-designed with our young advisory panel, and our work targets both individual support and the school policies and cultures that allow racism to persist.',
  'In what region will your work be delivered?': 'Scotland',
  'What is the post code of the delivery of your work?': 'G31 4EB',
  'In what region is your organisation based?': 'Scotland',
  "What is your organisation's specific location?": 'Glasgow',
  'Your organisation’s total income in the last year.': '780000',
  'Your organisation’s total expenditure in the last year.': '745000',
  'Your organisation’s total salaries in the last year.': '460000',
  'Your current unrestricted funding reserves.': '120000',
  'Please provide narrative on your unrestricted funding reserve sources.':
    'Unrestricted reserves stand at roughly 15% of annual income, built from individual giving and unrestricted trust grants. Trustees review the reserves policy annually against a target of two months’ operating costs.',
  'Your current restricted funding reserves.': '210000',
  'Please provide narrative on your restricted funding reserve sources.':
    'Restricted reserves relate to multi-year grants from The Robertson Trust and National Lottery Young Start, committed to named delivery staff and programmes through to 2028.',
  'Your balance at the time of application.': '165000',
  "Your bank's name": 'Royal Bank of Scotland',
  'Your bank account name': 'Amplify Youth Trust',
  'Your bank account number': '11223344',
  'Your bank sort code': '83-06-08',
  'Full-time': '12',
  'Part-time': '7',
  'Volunteers': '35',
  'Trustees': '9',
  'Which fund focus area does your funding request primarily relate to?': 'Anti-Racism',
  'Funding title': 'Speak Up: youth-led anti-racism ambassadors in Glasgow schools',
  'Does your funding request seek support for a solution or a cause (please provide narrative)?':
    'Both. Speak Up trains young people as anti-racism ambassadors who deliver peer-led sessions in their own schools — a direct solution for the young people they reach. Each cohort also works with school leadership to review incident-reporting and behaviour policies, addressing the systemic conditions that let racism go unchallenged. Learning is shared across our partner-school network and published annually.',
  'Why is this funding needed and how has the need been identified?':
    'Racist incidents recorded in Glasgow schools rose 28% between 2022 and 2025, and our own referral data shows a 60% increase in young people seeking support after racist incidents over the same period. In 2025 we consulted 240 young people across eight partner schools: 64% had witnessed racist behaviour at school in the past term, and the strongest preference expressed was for support led by other young people rather than adults. The programme design responds directly to that consultation, and an independent needs assessment commissioned in 2025 confirmed unmet demand in the east of the city.',
  'How many young people will benefit from our funding?': '320',
  'Please give ages or age ranges of the young people who will benefit.': '12–18',
  'Please give details on your organisation’s expertise in this application’s subject matter.':
    'We have delivered anti-racism youth work for 14 years. Our 2024 independent evaluation by the University of Strathclyde found significant improvements in reported school belonging and bystander confidence among participants. Our programme leads hold accredited anti-racist practice and trauma-informed training, we are Keeping Children Safe certified, and our youth advisory panel has co-designed every programme since 2019.',
  'Have you delivered work similar in nature to this application before?': 'Yes',
  'Please describe the challenges you encountered and your plans to address them if your application is successful.':
    'Two challenges from previous cohorts: school staff turnover disrupted delivery in three schools, which we now mitigate with signed memoranda of understanding and termly review meetings with each school; and ambassadors supporting peers through distressing incidents needed more support themselves, so all ambassadors now receive monthly group supervision from our clinical associate, costed into this budget.',
  'How much funding are you requesting from the7stars foundation?': '10000',
  'Do you have any other funding secured to date?': 'Yes',
  'If you have secured other funding, who was it from and for how much?':
    'The Robertson Trust — £30,000 over three years (core costs); National Lottery Young Start — £48,000 (delivery staff)',
  'Please use the below to outline your budget for the funding you are requesting:':
    'Year 1: Ambassador training programme, 24 young people — £2,600\nYear 1: Sessional youth worker support and group supervision — £1,900\nYear 1: Materials, travel and accessible venues — £500\nYear 2: Ambassador training programme, second cohort — £2,600\nYear 2: Sessional youth worker support and group supervision — £1,900\nYear 2: Evaluation and learning-share event with partner schools — £500',
  'Any additional notes':
    'The budget is £5,000 per year, matching the grant structure. Our 2024 independent evaluation and safeguarding policy are available on request.',
  'Budget total': '10000',
}

interface ApplicantPreset {
  key: string
  label: string
  note: string
  values: Record<string, string>
}

const PRESETS: ApplicantPreset[] = [
  {
    key: 'decent',
    label: 'Decent — BrightNet Youth (Online Abuse)',
    note: 'Solid alignment, young unevaluated pilot, partly anecdotal need. Expect a mid-band score.',
    values: PREFILL_DECENT,
  },
  {
    key: 'weak',
    label: 'Weak — Positive Vibes Community Group (Anti-Racism)',
    note: 'Adult-skewed events, no evidence or track record, reserves breach the 30% rule. Expect a low score.',
    values: PREFILL_WEAK,
  },
  {
    key: 'strong',
    label: 'Strong — Amplify Youth Trust (Anti-Racism)',
    note: 'Co-designed, externally evaluated, evidenced need, per-year budget. Expect a high score.',
    values: PREFILL_STRONG,
  },
]

// /api/apply acknowledges with 202 as soon as the raw payload is stored; mapping,
// scoring and due diligence run in the background. Outcomes live in the Review queue.
interface SubmitResult {
  status: 'received'
  ingestId: string
}

export function Submitter7Stars() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('apply_api_key') ?? '')
  const [programmeName, setProgrammeName] = useState('Social Impact Funding')
  const [presetKey, setPresetKey] = useState(PRESETS[0]!.key)
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...PRESETS[0]!.values }))
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0]!
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    setResult(null)

    try {
      if (!apiKey.trim()) throw new Error('Enter an API key (generate one on the Organisation screen)')
      // The payload mirrors a Gravity Forms webhook export: the form's own
      // labels as keys, plus the numeric Entry Id Gravity assigns. Only
      // programmeName is integration config rather than a form field.
      const payload: Record<string, string> = {
        programmeName: programmeName.trim(),
        'Entry Id': String(Date.now() % 1000000),
      }
      for (const section of SECTIONS) {
        for (const field of section.fields) {
          const v = (values[field.key] ?? '').trim()
          if (v) payload[field.key] = v
        }
      }
      const res = await fetch(`${API_BASE}/api/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.fields
          ? `${data.error}: ${data.fields.map((f: { field: string; message: string }) => `${f.field} (${f.message})`).join(', ')}`
          : (data.error ?? `HTTP ${res.status}`)
        throw new Error(msg)
      }
      setResult(data)
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      {result ? (
        <>
          <button
            onClick={() => setResult(null)}
            className="mb-6 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            ← Submit another
          </button>
          <SuccessView result={result} />
        </>
      ) : (
        <>
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
            the7stars foundation — simulated live form
          </p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Social Impact funding application</h1>
          <p className="mt-2 text-sm text-gray-600">
            Posts the real form's field labels as raw payload keys, the way a Gravity Forms
            webhook would. Some fields auto-map via the common dictionary; the amount, registration
            number and delivery postcode are expected to land in the Review queue.
          </p>

          <div className="mt-6 mb-8 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                API key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  localStorage.setItem('apply_api_key', e.target.value)
                }}
                placeholder="cust_sk_…  (generate on the Organisation screen)"
                className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                Programme name (integration config, not a form field)
              </label>
              <input
                value={programmeName}
                onChange={(e) => setProgrammeName(e.target.value)}
                className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                Applicant preset
              </label>
              <select
                value={presetKey}
                onChange={(e) => {
                  const next = PRESETS.find((p) => p.key === e.target.value)
                  if (!next) return
                  setPresetKey(next.key)
                  setValues({ ...next.values })
                }}
                className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">{preset.note} Switching replaces all form values.</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {SECTIONS.map((section) => (
              <Section key={section.title} title={section.title}>
                <div className="space-y-5">
                  {section.fields.map((field) => (
                    <SevenStarsInput
                      key={field.key}
                      field={field}
                      value={values[field.key] ?? ''}
                      onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                    />
                  ))}
                </div>
              </Section>
            ))}

            {submitError && (
              <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
            >
              {submitting ? 'Submitting…' : 'Submit application'}
            </button>
          </form>
        </>
      )}
    </Card>
  )
}

function SevenStarsInput({
  field,
  value,
  onChange,
}: {
  field: SevenStarsField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field label={field.key} required={!field.optional} hint={field.expect}>
      {field.type === 'textarea' ? (
        <textarea
          required={!field.optional}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'select' && field.options ? (
        <select required={!field.optional} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.type === 'date' ? (
        <input
          type="date"
          required={!field.optional}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === 'number' ? (
        <input
          type="number"
          required={!field.optional}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          required={!field.optional}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

function SuccessView({ result }: { result: SubmitResult }) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-4 text-green-800">
      <h2 className="text-sm font-semibold">Accepted (202)</h2>
      <p className="mt-1 text-xs opacity-80">Ingest ID: {result.ingestId}</p>
      <p className="mt-0.5 text-xs opacity-80">
        Mapping, scoring and due diligence run in the background — check the Review queue
        for the outcome.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-200 pt-6 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {hint && <p className="mb-1 text-xs text-amber-600">{hint}</p>}
      <div className="[&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-gray-300 [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:outline-none [&_input]:focus:border-indigo-500 [&_input]:focus:ring-1 [&_input]:focus:ring-indigo-500 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-gray-300 [&_select]:px-3 [&_select]:py-2 [&_select]:text-sm [&_select]:outline-none [&_select]:focus:border-indigo-500 [&_select]:focus:ring-1 [&_select]:focus:ring-indigo-500 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-gray-300 [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea]:focus:border-indigo-500 [&_textarea]:focus:ring-1 [&_textarea]:focus:ring-indigo-500">
        {children}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200">{children}</div>
    </div>
  )
}
