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

## Staging & migration workflow
Two deployed environments, both fed from `master`:
- **prod** — `custodian` Worker (`custodian.bental.workers.dev`), prod Neon branch.
- **staging** — `custodian-staging` Worker (`custodian-staging.bental.workers.dev`), Neon `staging` branch. Mirrors prod (same code, own per-env secrets); not behind Cloudflare Access.

**Local dev runs against the staging branch** — `.env`'s active `DATABASE_URL` is the staging branch (the prod string is commented out). So `pnpm dev` / `db:migrate` / `db:seed` / `db:studio` all act on staging; prod is never touched locally.

A push to `master` runs CI (`.github/workflows/ci.yml`) which **migrates then deploys staging, then migrates then deploys prod** — schema always lands before the code that needs it. **Do not run `db:migrate` against prod manually; CI owns prod migrations.**

### Default migration procedure (follow this by default)
1. Edit `drizzle/schema.ts`.
2. `pnpm db:generate`. For a **rename**, drizzle asks whether a column was renamed vs dropped+added — answer *rename* so it emits `ALTER ... RENAME COLUMN` (drop+add loses data). `generate` is local-only; CI never runs it.
3. `pnpm db:migrate` to apply to **staging**; verify the app still works. Staging holds real prod-snapshot data, so failures (e.g. adding `NOT NULL` to a populated table, bad type casts) surface here, not on prod.
4. **Commit the generated migration `.sql` + the `meta/` snapshot & journal together with the schema and code.** CI only applies migrations present in the repo — a missing file means prod code ships against a schema it doesn't have.
5. Push → CI migrates + deploys prod.

### Destructive changes (drop / rename / add NOT NULL / type change)
Because `master` deploys both Workers at once, for a few seconds old code runs against the new schema. Additive changes are safe. For destructive ones use **expand/contract** across separate pushes, so prod code and prod schema never disagree:
- **Rename** `a`→`b`: push 1 add `b` + write both + backfill; push 2 move reads to `b`; push 3 drop `a`.
- **Drop**: stop using the column in one push, drop it in a later push.

Only skip expand/contract for a deliberately-accepted brief blip on this low-traffic app (prefer off-hours).

## Environment variables
Local: `.env` file (loaded via `dotenv/config` in drizzle.config.ts and scripts).
Production: Cloudflare secrets — verify with `npx wrangler secret list`.

Required secrets: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `CHARITY_COMMISSION_KEY`, `COMPANIES_HOUSE_KEY`, `ANTHROPIC_API_KEY` (AI "Custodian score" scoring AND field-mapping AI fallback; both degrade gracefully if absent — scoring → `pending`, mapping → `needs_review`), `ADMIN_API_TOKEN` (shared secret gating the `/api/admin/*` field-mapping endpoints).

The admin app (`admin-app/`) must be built with `VITE_ADMIN_TOKEN` equal to the main app's `ADMIN_API_TOKEN`, and `VITE_API_BASE` pointing at the target main app. Locally these live in `admin-app/.env.local` (gitignored); in Cloudflare they're build-env vars on the admin project.

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
