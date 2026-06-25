import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../src/server/db'
import { getAuth } from '../src/server/auth'
import { accounts, clients, users } from '../drizzle/schema'

// Seeds test trustee accounts against whatever DATABASE_URL points at (locally
// that's the staging branch — see CLAUDE.md). Idempotent: re-running deletes and
// recreates the same users by email.
//
// Passwords are hashed with BetterAuth's own hasher and written straight into
// `accounts`, so we can use short dev passwords that the signup endpoint's
// 8-char minimum would otherwise reject. providerId 'credential' is what
// email/password sign-in looks up.
//
// One email maps to exactly one client (users.email is UNIQUE), so each client
// needs its own set of addresses.

const SEED_USERS = [
  { email: 'test1@test.com', name: 'Test Trustee One', password: 'test', role: 'trustee' as const, client: 'test fundy' },
  { email: 'test2@test.com', name: 'Test Trustee Two', password: 'test', role: 'trustee' as const, client: 'test fundy' },
  { email: 'test3@test.com', name: 'Test Trustee Three', password: 'test', role: 'trustee' as const, client: 'test fundy' },
  { email: 'testa@test.com', name: 'Test Trustee A', password: 'test', role: 'trustee' as const, client: 'Custodian Foundation' },
  { email: 'testb@test.com', name: 'Test Trustee B', password: 'test', role: 'trustee' as const, client: 'Custodian Foundation' },
  { email: 'testc@test.com', name: 'Test Trustee C', password: 'test', role: 'trustee' as const, client: 'Custodian Foundation' },
]

async function main() {
  const db = getDb()
  const auth = getAuth()
  const ctx = await auth.$context

  // Resolve each distinct client name to its id up front.
  const clientIdByName = new Map<string, string>()
  for (const name of new Set(SEED_USERS.map((u) => u.client))) {
    const client = (await db.select().from(clients).where(eq(clients.name, name))).at(0)
    if (!client) throw new Error(`Client "${name}" not found — create it first.`)
    clientIdByName.set(name, client.id)
  }

  const emails = SEED_USERS.map((u) => u.email)
  // Cascade on users → accounts/sessions removes the old auth rows too.
  await db.delete(users).where(inArray(users.email, emails))

  for (const u of SEED_USERS) {
    const userId = randomUUID()
    const now = new Date()
    await db.insert(users).values({
      id: userId,
      clientId: clientIdByName.get(u.client)!,
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
    console.log(`✓ ${u.email}  (${u.role}, password "${u.password}")  → ${u.client}`)
  }

  console.log(`\nSeeded ${SEED_USERS.length} users.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
