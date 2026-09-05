// `pnpm demo:partners` — a pipeline for the demo foundation.
//
// Free and instant: no model calls and no register calls. Due diligence is left
// UNSCREENED on every row on purpose, because "Not run" is the state a real pipeline is
// mostly in, and because pressing the button on the record is the thing worth showing.
//
// Idempotent by demolition, as `demo:seed` is: it clears the tenant's partnerships
// first, so re-running produces this dataset rather than a second copy of it. Dates are
// offsets from the run date for the same reason every other demo date is — a pipeline
// whose newest conversation is four months old demonstrates nothing.

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../../src/server/db'
import { partnerships, partnershipEvents, programmes, users } from '../../drizzle/schema'
import { daysAgo, done, requireDemoClient, runScript, step } from './lib/shared'
import type { PartnershipStatus } from '../../src/lib/partnerships/status'

type EventKind = 'logged' | 'note' | 'eoi_issued' | 'eoi_received' | 'invited' | 'declined'

type Seed = {
  name: string
  reference: string
  type: string
  location: string
  programme: string | null
  tags: string[]
  source: string
  status: PartnershipStatus
  charityNumber?: string
  companyNumber?: string
  contactName?: string
  contactEmail?: string
  amountSought?: number
  /**
   * Oldest first; each entry is `[days ago, what happened, kind]`. The kind matters
   * because the timeline draws a status event in brand and a note in grey — an EOI
   * arriving is not somebody's jotting, and a demo that dimmed the newest entry on
   * every record made the panel read backwards.
   */
  history: Array<[number, string, EventKind]>
  eoi?: Array<{ label: string; value: string }>
  eoiDaysAgo?: number
  archived?: { daysAgo: number; note: string }
}

const SEEDS: Seed[] = [
  {
    name: 'Settlefield Community Trust',
    reference: 'PTR-001',
    type: 'Registered charity',
    location: 'North Yorkshire',
    programme: 'Community Food',
    tags: ['Food poverty', 'Rural'],
    source: 'Advisor introduction',
    status: 'prospective',
    charityNumber: '1180432',
    contactName: 'Ruth Aldingham',
    contactEmail: 'ruth@settlefield.example',
    history: [[9, 'Introduced by James Hartley, who chairs their advisory panel.', 'logged']],
  },
  {
    name: 'Riverside Wellbeing',
    reference: 'PTR-002',
    type: 'Registered charity',
    location: 'Leeds',
    programme: null,
    tags: ['Mental health'],
    source: 'Trustee referral',
    status: 'prospective',
    contactName: 'Dev Chandra',
    contactEmail: 'dev@riversidewellbeing.example',
    history: [
      [6, 'Referred by Douglas after a conversation at the Leeds funders forum.', 'logged'],
      [2, 'Left a voicemail. Nothing back yet.', 'note'],
    ],
  },
  {
    name: 'Moorland Futures CIC',
    reference: 'PTR-003',
    type: 'CIC',
    location: 'Calderdale',
    programme: 'Wild Rivers',
    tags: ['Habitat restoration'],
    source: 'Sector event',
    status: 'eoi_issued',
    companyNumber: '11482201',
    contactName: 'Erin Vasey',
    contactEmail: 'erin@moorlandfutures.example',
    history: [
      [24, 'Met at the Pennine Water Forum. Upland peat restoration, founded 2021.', 'logged'],
      [11, 'Expression-of-interest form issued.', 'eoi_issued'],
    ],
  },
  {
    name: 'Wensleydale Voices',
    reference: 'PTR-004',
    type: 'Registered charity',
    location: 'Leyburn, North Yorkshire',
    programme: 'Youth Futures',
    tags: ['Isolation', 'Rural', 'Arts'],
    source: 'Expression of interest',
    status: 'eoi_received',
    charityNumber: '1198721',
    contactName: 'Helen Marsh',
    contactEmail: 'helen@wensleydalevoices.example',
    amountSought: 18000,
    history: [
      [21, 'Expression-of-interest form issued.', 'eoi_issued'],
      [4, 'Expression of interest received.', 'eoi_received'],
    ],
    eoiDaysAgo: 4,
    eoi: [
      {
        label: 'Describe your organisation and its work',
        value:
          'Wensleydale Voices is a community choir and arts organisation based in Leyburn. We work with 200+ participants across all ages, delivering weekly singing sessions, community performances and outreach in rural and isolated communities.',
      },
      {
        label: "How does your work align with the Foundation's priorities?",
        value:
          'Our work addresses social isolation in rural areas, supporting cohesion and wellbeing across decile 4–6 communities in the Dales.',
      },
      {
        label: 'What funding are you seeking, and for what?',
        value:
          '£18,000 over 12 months for a part-time community outreach coordinator and transport costs, to extend our reach to three additional villages.',
      },
      {
        label: 'What outcomes do you expect?',
        value:
          '150 additional participants engaged. Three new rural community groups established. A measurable reduction in reported isolation among participants.',
      },
    ],
  },
  {
    name: 'Headingley Learning',
    reference: 'PTR-005',
    type: 'Registered charity',
    location: 'Leeds',
    programme: 'Youth Futures',
    tags: ['Education', 'Attainment'],
    source: 'Prior grantee',
    status: 'invited',
    charityNumber: '1094289',
    contactName: 'Sam Oyelaran',
    contactEmail: 'sam@headingleylearning.example',
    amountSought: 55000,
    history: [
      [
        40,
        'Identified as a strong candidate for renewal after their Year 3 final report.',
        'logged',
      ],
      [12, 'Invited to submit a full application.', 'invited'],
    ],
  },
  {
    name: 'Ribble Street Studios',
    reference: 'PTR-006',
    type: 'CIC',
    location: 'Burnley',
    programme: null,
    tags: ['Arts'],
    source: 'Direct approach',
    status: 'declined',
    companyNumber: '12903811',
    contactEmail: 'hello@ribblestreet.example',
    history: [
      [30, 'Approached us directly by email.', 'logged'],
      [
        17,
        'Closed — not pursuing. Outside our funding area, and no delivery in the Dales.',
        'declined',
      ],
    ],
  },
  {
    name: 'Growing Roots CIC',
    reference: 'PTR-007',
    type: 'CIC',
    location: 'Sheffield',
    programme: 'Community Food',
    tags: ['Food poverty', 'Growing'],
    source: 'Advisor introduction',
    status: 'prospective',
    companyNumber: '10552214',
    contactName: 'Aisha Bello',
    contactEmail: 'aisha@growingroots.example',
    history: [
      [3, 'Second introduction from James Hartley. Community growing across four sites.', 'logged'],
    ],
  },
  {
    name: 'Calder Valley Warmth',
    reference: 'PTR-008',
    type: 'Community group',
    location: 'Hebden Bridge',
    programme: 'Warm Homes',
    tags: ['Fuel poverty'],
    source: 'Funder referral',
    status: 'declined',
    contactEmail: 'info@caldervalleywarmth.example',
    history: [
      [95, 'Referred by the Calderdale community foundation.', 'logged'],
      [70, 'Closed — not pursuing. Merged into a larger organisation we already fund.', 'declined'],
    ],
    archived: { daysAgo: 60, note: 'Merged into Calderdale Energy Advice' },
  },
]

runScript('demo:partners', async () => {
  const db = getDb()
  const client = await requireDemoClient()

  step('Clearing the previous pipeline')
  // `partnership_events` cascades from the partnership, so one delete is the lot.
  await db.delete(partnerships).where(eq(partnerships.clientId, client.id))

  const progs = await db.query.programmes.findMany({
    where: eq(programmes.clientId, client.id),
    columns: { id: true, name: true },
  })
  const programmeId = (name: string | null) =>
    name ? (progs.find((p) => p.name === name)?.id ?? null) : null

  const admin = await db.query.users.findFirst({
    where: eq(users.email, 'helen@wrenfield.example'),
    columns: { id: true },
  })
  const actorId = admin?.id ?? null

  step(`Seeding ${SEEDS.length} partners`)
  for (const seed of SEEDS) {
    const id = randomUUID()
    const logged = daysAgo(seed.history[0]![0])
    await db.insert(partnerships).values({
      id,
      clientId: client.id,
      organisationName: seed.name,
      reference: seed.reference,
      organisationType: seed.type,
      location: seed.location,
      charityNumber: seed.charityNumber ?? null,
      companyNumber: seed.companyNumber ?? null,
      source: seed.source,
      programmeId: programmeId(seed.programme),
      tags: seed.tags,
      contactName: seed.contactName ?? null,
      contactEmail: seed.contactEmail ?? null,
      status: seed.status,
      amountSought: seed.amountSought === undefined ? null : String(seed.amountSought),
      eoiResponses: seed.eoi ?? null,
      eoiReceivedAt: seed.eoiDaysAgo === undefined ? null : daysAgo(seed.eoiDaysAgo),
      archivedAt: seed.archived ? daysAgo(seed.archived.daysAgo) : null,
      archiveNote: seed.archived?.note ?? null,
      createdAt: logged,
      updatedAt: logged,
    })

    await db.insert(partnershipEvents).values(
      seed.history.map(([days, body, kind]) => ({
        partnershipId: id,
        kind,
        body,
        // Attributed to the foundation's admin, except an EOI ARRIVING — that one
        // comes through a form with nobody in the building involved, and a null actor
        // is what renders it as "Custodian". "Introduced by James Hartley", by
        // contrast, is something somebody here wrote down.
        actorUserId: kind === 'eoi_received' ? null : actorId,
        occurredAt: daysAgo(days),
      })),
    )
  }

  done(`${SEEDS.length} partners in ${client.name}'s pipeline`)
})
