# Custodian — Claude Code Context

## What this project is
Grant management platform for philanthropic organisations. Clients (charitable foundations / family offices) manage funding rounds, programmes, applications, and users through a single app.

## Stack
- **Framework**: TanStack Start (React, file-based routing via `src/routes/`)
- **Auth**: BetterAuth (`src/server/auth.ts`) — Google OAuth + email/password
- **ORM**: Drizzle ORM — schema at `drizzle/schema.ts`, migrations at `drizzle/migrations/`
- **Database**: Neon (PostgreSQL, serverless driver `@neondatabase/serverless`)
- **Runtime**: Cloudflare Workers (deployed via `wrangler`)
- **Email**: Resend (`src/lib/email.ts`)
- **Package manager**: pnpm

## Deployment
- **Production URL**: `https://custodian.bental.workers.dev`
- **Deploy method**: push to `master` → GitHub Actions (`.github/workflows/ci.yml`) runs typecheck → build → `wrangler deploy`
- Do NOT run `npx wrangler deploy` manually unless testing outside of CI — the GitHub Action is the deploy path
- Cloudflare secrets are managed via `npx wrangler secret put <KEY>` — they are NOT in `.env` for production

## Local development
```sh
pnpm dev          # vite dev server (localhost:5174)
pnpm typecheck    # tsc --noEmit
pnpm build        # production build
pnpm preview      # build + wrangler dev (local Workers simulation)
```

## Database
```sh
pnpm db:generate  # generate migration from schema changes
pnpm db:migrate   # apply migrations to Neon
pnpm db:studio    # Drizzle Studio GUI
pnpm db:seed      # run scripts/seed.ts
```
Schema changes: edit `drizzle/schema.ts` → `pnpm db:generate` → `pnpm db:migrate`.

**Never use `db:push`.** It applies schema changes without recording them in `drizzle.__drizzle_migrations`, which causes `db:migrate` to fail later. The script has been removed from `package.json`.

## Environment variables
Local: `.env` file (loaded via `dotenv/config` in drizzle.config.ts and scripts).
Production: Cloudflare secrets — verify with `npx wrangler secret list`.

Required secrets: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `CHARITY_COMMISSION_KEY`, `COMPANIES_HOUSE_KEY`, `ANTHROPIC_API_KEY` (AI "Custodian score" scoring; scoring degrades gracefully to `pending` if absent).

`BETTER_AUTH_URL` must be `https://custodian.bental.workers.dev` in production — if wrong, Google OAuth returns "Account not linked".

## Auth notes
- BetterAuth lazy-initialised in `src/server/auth.ts` (prevents Cloudflare Workers module poisoning on missing env vars)
- `worker-entry.js` bridges Cloudflare env bindings into `process.env` before delegating to the app server
- `requireLocalEmailVerified: false` — Google's email verification is trusted; no need for separate local verification
- Account linking is enabled: a user can sign up via Google then later add email/password (via password reset flow), or vice versa
- Google OAuth authorized redirect URI in Google Console: `https://custodian.bental.workers.dev/api/auth/callback/google`

## Data model summary
- **clients** — tenant (charitable_foundation | family_office); users and rounds belong to a client
- **users** — extend BetterAuth user; have a `role` (superadmin → trustee) and belong to one client
- **rounds** → **programmes** → **formFields** — funding rounds contain programmes which have dynamic application forms
- **applications** + **applicationResponses** — submitted grant applications with per-field responses
- **invitations** — token-based invitation flow; users are invited to a client with a role
- BetterAuth tables: `sessions`, `accounts`, `verifications` (do not modify these manually)

## Route structure
- `src/routes/_authenticated.tsx` — layout + auth guard for all protected routes
- `src/routes/_authenticated/*.tsx` — dashboard, profile, users, applications
- `src/routes/api/auth.$.ts` — BetterAuth handler (GET + POST)
- `src/routes/api/apply.ts`, `api/round.$roundId.ts` — public-facing application endpoints
- `src/server/fns/` — server functions (TanStack Start server-side, called from routes)
