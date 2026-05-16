import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './db'

if (!process.env['BETTER_AUTH_SECRET']) {
  throw new Error('BETTER_AUTH_SECRET is required')
}

export const auth = betterAuth({
  secret: process.env['BETTER_AUTH_SECRET'],
  baseURL: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
      clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
    },
  },
})
