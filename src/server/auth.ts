import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb } from './db'
import { users, sessions, accounts, verifications } from '../../drizzle/schema'

// Lazy so the module can be imported without throwing on missing env vars —
// env is only read (and validated) the first time a request needs auth.
// This prevents Cloudflare Workers' esbuild __esm module from being
// permanently poisoned if the secret is absent on first load.
let _auth: ReturnType<typeof betterAuth> | undefined

export function getAuth(): ReturnType<typeof betterAuth> {
  if (!_auth) {
    if (!process.env['BETTER_AUTH_SECRET']) throw new Error('BETTER_AUTH_SECRET is required')
    _auth = betterAuth({
      secret: process.env['BETTER_AUTH_SECRET'],
      baseURL: process.env['BETTER_AUTH_URL'] ?? 'http://localhost:3000',
      onAPIError: {
        errorURL: '/sign-in',
      },
      database: drizzleAdapter(getDb(), {
        provider: 'pg',
        schema: {
          user: users,
          session: sessions,
          account: accounts,
          verification: verifications,
        },
      }),
      account: {
        accountLinking: {
          requireLocalEmailVerified: false,
        },
      },
      emailAndPassword: {
        enabled: true,
        // To require email verification before sign-in, uncomment below and wire up Resend (or similar):
        // requireEmailVerification: true,
        // sendResetPassword: async ({ user, url }) => {
        //   await resend.emails.send({
        //     from: 'noreply@yourdomain.com',
        //     to: user.email,
        //     subject: 'Reset your password',
        //     html: `<a href="${url}">Reset password</a>`,
        //   })
        // },
      },
      // emailVerification: {
      //   sendOnSignUp: true,
      //   autoSignInAfterVerification: true,
      //   sendVerificationEmail: async ({ user, url }) => {
      //     await resend.emails.send({
      //       from: 'noreply@yourdomain.com',
      //       to: user.email,
      //       subject: 'Verify your email',
      //       html: `<a href="${url}">Verify email</a>`,
      //     })
      //   },
      // },
      socialProviders: {
        google: {
          clientId: process.env['GOOGLE_CLIENT_ID'] ?? '',
          clientSecret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
        },
      },
    }) as ReturnType<typeof betterAuth>
  }
  return _auth
}
