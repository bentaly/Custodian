// `pnpm demo:seed` — build the demo foundation's structure.
//
// Idempotent by demolition: it tears the tenant down first, so re-running always
// produces the same dataset rather than a second copy alongside the first.
//
// This step is free and instant. It stops short of applications, which are created by
// `pnpm demo:apply` through the real ingest pipeline (model + register calls, and the
// only step that costs anything).

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { getDb } from '../../src/server/db'
import { getAuth } from '../../src/server/auth'
import {
  accounts,
  apiKeys,
  clientProfiles,
  clients,
  invitations,
  programmes,
  roundProgrammes,
  rounds,
  users,
} from '../../drizzle/schema'
import { generateApiKey, hashApiKey } from '../../src/server/apiKeys'
import { CLIENT, OWNER_EMAIL, PROGRAMMES, ROUNDS, STAFF, DEMO_PASSWORD } from './lib/data'
import { teardownDemo } from './lib/teardown'
import { daysFromNow, findDemoClient, runScript, step, done } from './lib/shared'

const HERE = dirname(fileURLToPath(import.meta.url))

runScript('demo:seed', async () => {
  const db = getDb()

  // ── 1. Start from nothing ──────────────────────────────────────────────────
  const existing = await findDemoClient()
  if (existing) {
    step(`Removing the previous "${existing.name}"`)
    await teardownDemo(existing.id)
  }

  // ── 2. The foundation ──────────────────────────────────────────────────────
  step('Creating the foundation')
  const [client] = await db
    .insert(clients)
    .values({
      name: CLIENT.name,
      type: CLIENT.type,
      description: CLIENT.description,
      website: CLIENT.website,
    })
    .returning({ id: clients.id })
  const clientId = client!.id
  done(`${CLIENT.name} (${clientId})`)

  await db.insert(clientProfiles).values({
    clientId,
    missionStatement: CLIENT.missionStatement,
    // Admins can record votes on behalf of trustees, so the per-trustee toggle in the
    // shortlist roster is visible rather than hidden behind a setting nobody turned on.
    allowAdminVoting: true,
    awardLetterSignatory: 'Helen Ashworth, Director',
    awardLetterSenderName: CLIENT.name,
    awardLetterReplyTo: 'grants@wrenfield.example',
  })
  done('profile, mission statement and award-letter settings')

  // ── 3. Programmes ──────────────────────────────────────────────────────────
  step('Creating programmes')
  const programmeIdByKey: Record<string, string> = {}
  for (const p of PROGRAMMES) {
    const [row] = await db
      .insert(programmes)
      .values({
        clientId,
        name: p.name,
        goal: p.goal,
        colour: p.colour,
        impactUnit: p.impactUnit,
        impactUnitLabel: p.impactUnitLabel ?? null,
        tags: p.tags,
      })
      .returning({ id: programmes.id })
    programmeIdByKey[p.key] = row!.id
    done(`${p.name} — measured in ${p.impactUnitLabel ?? p.impactUnit}`)
  }

  // ── 4. Rounds and their programme budgets ──────────────────────────────────
  //
  // Both rounds are created with their FINAL dates here. `demo:apply` moves them
  // temporarily while it submits — an application can only be posted to a programme
  // in an OPEN round — and puts them back when it is finished.
  step('Creating rounds')
  for (const r of ROUNDS) {
    const [round] = await db
      .insert(rounds)
      .values({
        clientId,
        name: r.name,
        openedAt: daysFromNow(-r.openedDaysAgo),
        closedAt: r.closedDaysAgo === null ? null : daysFromNow(-r.closedDaysAgo),
      })
      .returning({ id: rounds.id })

    let total = 0
    for (const [programmeKey, b] of Object.entries(r.budgets)) {
      await db.insert(roundProgrammes).values({
        roundId: round!.id,
        programmeId: programmeIdByKey[programmeKey]!,
        budget: String(b.budget),
        maxGrantAmount: String(b.maxGrant),
        grantDurationYears: b.years,
      })
      total += b.budget
    }
    const closes =
      r.closedDaysAgo === null
        ? 'open-ended'
        : r.closedDaysAgo < 0
          ? `closes in ${-r.closedDaysAgo} days`
          : `closed ${r.closedDaysAgo} days ago`
    done(
      `${r.name} — £${total.toLocaleString('en-GB')} across ${Object.keys(r.budgets).length} programmes, ${closes}`,
    )
  }

  // ── 5. Staff ───────────────────────────────────────────────────────────────
  //
  // Passwords are hashed with BetterAuth's own hasher and written straight into
  // `accounts`, exactly as scripts/seed.ts does — the sign-up endpoint's 8-character
  // minimum would otherwise reject a memorable demo password.
  step('Creating staff logins')
  const auth = getAuth()
  const ctx = await auth.$context
  for (const u of STAFF) {
    // One email maps to exactly one client (users.email is UNIQUE), so a stale row from
    // an earlier tenant would collide. Teardown removes ours; this covers the rest.
    await db.delete(users).where(eq(users.email, u.email))

    const userId = randomUUID()
    const now = new Date()
    await db.insert(users).values({
      id: userId,
      clientId,
      name: u.name,
      email: u.email,
      role: u.role,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(accounts).values({
      id: randomUUID(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: await ctx.password.hash(u.password),
      createdAt: now,
      updatedAt: now,
    })
    done(`${u.name} — ${u.email} (${u.role})`)
  }
  console.log(`\n  all staff passwords: "${DEMO_PASSWORD}"`)

  // ── 6. The owner's invitation ──────────────────────────────────────────────
  //
  // Deliberately an invitation rather than a user row. The address already exists as a
  // Google account with no tenant; `getMe` auto-claims a pending invite by email for
  // any tenant-less non-superadmin, so signing in with Google attaches it as an admin
  // through the real product path instead of one we wrote by hand.
  step('Inviting the owner')
  await db.insert(invitations).values({
    clientId,
    email: OWNER_EMAIL,
    role: 'admin',
    token: randomUUID(),
    expiresAt: daysFromNow(30),
    invitedByEmail: 'demo-seed',
  })
  done(`${OWNER_EMAIL} invited as admin — sign in with Google to claim it`)

  // ── 7. An API key for the submission endpoint ──────────────────────────────
  //
  // Only a hash is stored, so a generated key is visible exactly once — which meant the
  // key from the last seed was unrecoverable the moment the terminal scrolled. Two
  // fixes: honour `DEMO_API_KEY` from the environment if it is set (stable across
  // re-seeds), and write whatever key we end up with to a gitignored file so it can be
  // read back.
  step('Creating an API key')
  const key = process.env.DEMO_API_KEY?.trim() || generateApiKey().key
  await db.insert(apiKeys).values({
    clientId,
    name: 'Demo intake integration',
    keyHash: await hashApiKey(key),
    last4: key.slice(-4),
    createdBy: 'demo-seed',
  })
  done(
    process.env.DEMO_API_KEY
      ? 'using DEMO_API_KEY from the environment'
      : 'generated (set DEMO_API_KEY to keep one key across re-seeds)',
  )

  // ── 8. Write the credentials down ──────────────────────────────────────────
  const credentialsFile = join(HERE, 'CREDENTIALS.local.md')
  writeFileSync(
    credentialsFile,
    [
      `# Demo credentials — ${CLIENT.name}`,
      '',
      `Written by \`pnpm demo:seed\` on ${new Date().toISOString()}.`,
      'Gitignored: regenerated on every seed, and the API key cannot be recovered any',
      'other way (only its hash is stored).',
      '',
      '## Sign in',
      '',
      `Google SSO: **${OWNER_EMAIL}** — invited as admin, claimed on first sign-in.`,
      '',
      '| Name | Email | Role | Password |',
      '| --- | --- | --- | --- |',
      ...STAFF.map((u) => `| ${u.name} | ${u.email} | ${u.role} | \`${u.password}\` |`),
      '',
      '## API key (`/api/apply`, `/api/submit-report`, admin app Testing screen)',
      '',
      '```',
      key,
      '```',
      '',
      'Set `DEMO_API_KEY` in `.env` to keep the same key across re-seeds.',
      '',
    ].join('\n'),
  )
  done(`credentials written to ${credentialsFile}`)
  console.log(`\n  APPLY KEY: ${key}\n`)
})
