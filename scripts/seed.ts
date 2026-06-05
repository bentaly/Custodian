/**
 * Seeds a test client, round, programme, and form fields.
 * Run with: pnpm tsx scripts/seed.ts
 *
 * Outputs the round ID and programme ID which the test app needs.
 */
import { config } from 'dotenv'
config()

import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from '../drizzle/schema'
import { eq } from 'drizzle-orm'

const sql = neon(process.env['DATABASE_URL']!)
const db = drizzle(sql, { schema })

async function seed() {
  console.log('Seeding test data...\n')

  // Client
  const existingClient = await db.query.clients.findFirst({
    where: eq(schema.clients.name, 'Greenfield Charitable Trust'),
  })

  let client = existingClient
  if (!client) {
    ;[client] = await db
      .insert(schema.clients)
      .values({
        name: 'Greenfield Charitable Trust',
        type: 'charitable_foundation',
        description:
          'A grant-making foundation focused on community wellbeing, environmental sustainability, and arts access across the UK.',
        website: 'https://greenfield-trust.example.com',
      })
      .returning()
    console.log('Created client:', client!.id)
  } else {
    console.log('Found existing client:', client.id)
  }

  // Round
  const existingRound = await db.query.rounds.findFirst({
    where: eq(schema.rounds.name, 'Spring 2026'),
  })

  let round = existingRound
  if (!round) {
    ;[round] = await db
      .insert(schema.rounds)
      .values({
        clientId: client!.id,
        name: 'Spring 2026',
        budget: '250000',
        status: 'open',
        openedAt: new Date(),
      })
      .returning()
    console.log('Created round:', round!.id)
  } else {
    console.log('Found existing round:', round.id)
  }

  // Programme
  const existingProgramme = await db.query.programmes.findFirst({
    where: eq(schema.programmes.name, 'Community Impact Grants'),
  })

  let programme = existingProgramme
  if (!programme) {
    ;[programme] = await db
      .insert(schema.programmes)
      .values({
        roundId: round!.id,
        name: 'Community Impact Grants',
        description:
          'Open grants of up to £25,000 for registered charities delivering measurable community impact.',
        status: 'active',
      })
      .returning()
    console.log('Created programme:', programme!.id)
  } else {
    console.log('Found existing programme:', programme.id)
  }

  // Form fields (idempotent: only create if programme has no fields)
  const existingFields = await db.query.formFields.findMany({
    where: eq(schema.formFields.programmeId, programme!.id),
  })

  if (existingFields.length === 0) {
    const fields = [
      {
        programmeId: programme!.id,
        label: 'Organisation location (region)',
        fieldType: 'select' as const,
        displayOrder: 1,
        required: true,
        options: [
          'London',
          'South East',
          'South West',
          'East of England',
          'West Midlands',
          'East Midlands',
          'Yorkshire and the Humber',
          'North West',
          'North East',
          'Wales',
          'Scotland',
          'Northern Ireland',
        ],
      },
      {
        programmeId: programme!.id,
        label: 'Primary cause area',
        fieldType: 'select' as const,
        displayOrder: 2,
        required: true,
        options: [
          'Arts, culture and heritage',
          'Children and young people',
          'Community development',
          'Education and training',
          'Environment and conservation',
          'Health and wellbeing',
          'Homelessness and housing',
          'Mental health',
          'Older people',
          'Sport and recreation',
          'Other',
        ],
      },
      {
        programmeId: programme!.id,
        label: 'Brief project description',
        fieldType: 'textarea' as const,
        displayOrder: 3,
        required: true,
      },
      {
        programmeId: programme!.id,
        label: 'Number of direct beneficiaries',
        fieldType: 'number' as const,
        displayOrder: 4,
        required: true,
      },
      {
        programmeId: programme!.id,
        label: 'Have you received funding from this foundation before?',
        fieldType: 'select' as const,
        displayOrder: 5,
        required: true,
        options: ['Yes', 'No'],
      },
      {
        programmeId: programme!.id,
        label: 'Project start date',
        fieldType: 'date' as const,
        displayOrder: 6,
        required: false,
      },
    ]

    await db.insert(schema.formFields).values(fields)
    console.log(`Created ${fields.length} form fields`)
  } else {
    console.log(`Found ${existingFields.length} existing form fields`)
  }

  console.log('\n✓ Seed complete')
  console.log(`\nRound ID:      ${round!.id}`)
  console.log(`Programme ID:  ${programme!.id}`)
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
