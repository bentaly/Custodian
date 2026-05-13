import type { PrismaClient } from '@custodian/db'

export type ClerkUser = {
  id: string
  clerkId: string
  email: string
  role: string
}

export type Context = {
  db: PrismaClient
  user: ClerkUser | null
}

export type AuthenticatedContext = Context & {
  user: ClerkUser
}
