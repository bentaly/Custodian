import type { PrismaClient } from '@custodian/db'

export type AuthUser = {
  id: string
  email: string
  role: string
}

export type Context = {
  db: PrismaClient
  user: AuthUser | null
}

export type AuthenticatedContext = Context & {
  user: AuthUser
}
