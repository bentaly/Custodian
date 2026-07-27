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
pnpm test         # vitest run (unit tests: invites, due diligence, deprivation, …)
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
- Three ways in, all on `/sign-in`: **email + password**, **Google OAuth**, and an emailed
  **6-digit code** (`emailOTP` plugin). Plus a code-based **password reset**.
- `requireLocalEmailVerified: false` — Google's email verification is trusted; no need for separate
  local verification. This is load-bearing, not cosmetic: BetterAuth's default is `true`, and local
  sign-up leaves `email_verified = false` (no verification email is wired), so on the default an
  existing email+password user clicking "Continue with Google" would be **refused** with
  `account_not_linked` instead of linking.
- Account linking: a password user who later uses Google is auto-linked (see above). The reverse —
  a Google-only user adding a password — goes through the **code-based reset** on `/sign-in`
  ("Forgot your password?"): `/email-otp/reset-password` creates a `credential` account when the
  user has none. There is no link-based reset; `emailAndPassword.sendResetPassword` is deliberately
  not configured, so `/request-password-reset` returns `RESET_PASSWORD_DISABLED`.
- **`emailOTP` runs with `disableSignUp: true`** — without it the plugin signs up any unknown email
  on the spot, and since `users.client_id` is nullable that insert *succeeds*, minting a clientless
  `observer` with a live session and no invitation. Both OTP flows therefore only work for users who
  already exist; a code is **not** a way to accept an invite.
- Codes: 6 digits, 5-minute expiry, 3 attempts, stored **hashed** in `verifications`. An unknown
  email gets `{success: true}` and **no email** — BetterAuth deliberately won't confirm whether an
  account exists (anti-enumeration), so sign-in copy must stay "if an account exists…".
- OTP sign-in resolves by **email only** — no provider check — so a code works regardless of whether
  the user registered via Google or password. It also sets `email_verified = true` as a side effect.
- Google OAuth authorized redirect URI in Google Console: `https://custodian.bental.workers.dev/api/auth/callback/google`

## Invite-only onboarding
An invitation creates **no user row** — only an `invitations` row (email, token, `clientId`, role,
7-day expiry). The `users` row appears when the invitee registers, with `client_id = null`; a user is
attached to a tenant only by `claimPendingInvite` (`src/server/invites.ts`), which is the sole path
granting tenant access. Two routes in:
- **Invite link** → `/sign-up?invite=<token>` — password sign-up *or* "Continue with Google". Claiming
  by token also sets `email_verified = true`: possessing a token mailed to that address is the same
  proof a verification email would give, which is why no verification email is wired.
- **Google** → the invitee ignores the link and hits "Continue with Google" on `/sign-in`. OAuth
  never calls `completeRegistration`, so `getMe` (`src/server/fns/auth.ts`) auto-claims a pending
  invite **by email** for any tenant-less non-superadmin. This is why `claimPendingInvite` matches on
  email when no token is given.

**The tokenless email match requires `emailVerified`** (`invites.ts`) — do not remove it, and see
`invites.test.ts`. `/api/auth/sign-up/email` is a public endpoint that accepts any address without
proving it, so without the gate anyone who knew an invited address (staff emails are often public)
could sign up as it, let `getMe` hand them the invite, and land inside the tenant at the invited
role — no token, no mailbox access. Google-proved addresses are unaffected; token claims skip the
check because the token *is* the proof.

No valid invite → `client_id` stays null → `_authenticated`'s guard redirects to `/no-access`.
Superadmins legitimately have no `client_id` and are exempt. Signups without an invite still create
an inert account (no tenant, bounced to `/no-access`); closing that off entirely would mean creating
users server-side and setting `emailAndPassword.disableSignUp`, which the invite page's
`authClient.signUp.email` call currently depends on.

## Data model summary
- **clients** — tenant (charitable_foundation | family_office); users and rounds belong to a client
- **users** — extend BetterAuth user; have a `role` (superadmin | admin | trustee | finance) and belong to one client.
  `superadmin` is platform-level (no `client_id`); `admin` runs a foundation; `trustee` reads/comments/votes;
  `finance` is a trustee plus the payment schedule (instalment edits, marking paid) — but never grant decisions.
  Default is `trustee`, both on the columns and BetterAuth's `defaultRole`. The old `manager`/`contributor`/`observer`
  values were folded in by migration 0049 (manager→admin, contributor/observer→trustee)
- **user_avatars** — profile photos, kept off the `users` row (which `getAuthUser` selects on
  every authenticated call); `users.image` holds the `/api/avatar/$userId?v=<hash>` URL
- **client_profiles** — per-tenant settings (mission statement, admin-voting toggle)
- **rounds** ↔ **programmes** via **round_programmes** (budget, grant duration, impact unit per pairing); applications hang off a round-programme
- **applications** — one row per submission; responses/budget lines live in jsonb columns, plus AI columns (Custodian score, due diligence, deprivation context)
- **application_comments** / **application_votes** — discussion + trustee voting (majority gates `generateAward`)
- **awards** → **award_instalments** (payment schedule) + **report_schedule** (reporting milestones) — a grant minted from an awarded application
- **reports** — received grant reports (from `/api/submit-report`), with AI analysis columns; **report_ingests** is its holding table
- **application_ingests** + **field_mappings** — `/api/apply` holding table and the learned field-name mappings
- **deprivation_areas** — IMD decile lookup data (seeded by `scripts/seed-deprivation.ts`)
- **audit_log** — human actions (award/decline/shortlist/comment) with actor; feeds the dashboard "Lately" feed
- **invitations** — token-based invitation flow; users are invited to a client with a role
- **api_keys** — per-client secret keys gating `/api/apply` (see below)
- BetterAuth tables: `sessions`, `accounts`, `verifications` (do not modify these manually)

## Server-side patterns
- **No `db.transaction()`** — `getDb()` uses the neon-http driver, where `transaction()` throws at
  runtime. Use `db.batch()` for atomic multi-statement writes.
- **Tenancy**: every server fn scopes reads/writes to the caller's client. List queries go through
  `visibleRoundProgrammeIds(user)` + `intersectScope` (`src/server/scope.ts`); fetch-by-id goes
  through `assertClientAccess` / `assertApplicationAccess`. `null` scope = superadmin, unrestricted.
  Any query filtering on a cross-tenant column (e.g. `organisationName`) must ALSO scope by client.
- **Post-response work**: `runInBackground` (`src/server/background.ts`) wraps `ctx.waitUntil` so
  pipelines survive the Workers teardown after the response is sent. Background work must have a
  durable failure story (e.g. an ingest row stuck at `received` is visible and reprocessable).
- **Degrade gracefully**: AI features without `ANTHROPIC_API_KEY`, rate limiting without its
  binding, and email without Resend all no-op or fall back rather than failing the request.

## Public submission auth (`/api/apply`)
A foundation's intake integration posts applications to `POST /api/apply` authenticated with
`Authorization: Bearer <api key>`. The key resolves to the owning client — there is **no
`clientId` in the request body** (the old design; a key both names the client and proves the
caller may submit as it). **The request body IS the payload** — a flat object of the
foundation's own field names → values, with no reserved top-level keys. JSON or form-encoded
(`application/x-www-form-urlencoded` / `multipart/form-data`) are both accepted. Every field,
including the foundation's own application reference, is mapped to canonical fields; the ref
maps to the `externalApplicationId` canonical field (no special top-level key). The only
door-level check is "non-empty object"; real validation runs downstream on the mapped
canonical fields (`CreateApplicationSchema`).
- Keys live in the `api_keys` table: only a **SHA-256 hash** is stored (plus `last4` for display);
  plaintext is shown once at creation, never again. Format `cust_sk_…`.
- Auth helpers: `src/server/apiKeys.ts` (`generateApiKey`, `hashApiKey`, `authenticateApiKey`).
  Management server fns: `src/server/fns/apiKeys.ts` (`listApiKeys`/`createApiKey`/`revokeApiKey`,
  admin-only, scoped to the caller's client).
- UI: **Settings → API keys** (`/settings/api-keys`), admin-only. `/settings/submissions` documents
  the endpoints and renders the canonical field registries, so those docs cannot drift from the mapper.
- Test/dev submitter: `admin-app/src/Submitter.tsx` has an API key field (stored in localStorage).
- Missing/invalid/revoked key → 401. `/api/apply` is rate-limited two ways (`src/server/rateLimit.ts`,
  bindings in `wrangler.toml`): a per-IP volumetric backstop before auth (`APPLY_IP_LIMITER`) and a
  per-client fairness limit after (`APPLY_KEY_LIMITER`). Degrades open — no binding (local dev) or a
  limiter error means the request proceeds, mirroring how the AI features degrade without their key.
- **`POST /api/submit-report`** is the report-side twin: same key auth + 202 + background
  pipeline, its own canonical registry (`src/lib/fieldMapping/reportCanonical.ts`) and holding
  table (`report_ingests`). Auto-links to a grant only on an exact `externalApplicationId`
  match; everything else is held for the admin Report queue (heuristic grant candidates are
  suggestions only). Promoted submissions live in `report_submissions` (AI analysis: summary,
  application/programme alignment, challenges/lessons, impact quantity in the programme's
  `impactUnit`), tick the earliest open `grant_reports` milestone, and surface on the
  in-app Reports screen (`/reports`).
- British English in all copy/identifiers (e.g. "Organisation", not "Organization").

## Route structure
- `src/routes/_authenticated.tsx` — layout + auth guard for all protected routes
- `src/routes/_authenticated/*.tsx` — dashboard, applications (+detail), shortlist, awards
  (+detail), finance (+detail), reports (+detail), rounds (+detail), programmes (+detail),
  insights, profile, and the Settings hub
- **Settings** (`/settings`) — a card-grid hub for everything that is configuration rather than daily
  work. Sub-pages: `team`, `giving-strategy`, `voting`, `api-keys`, `submissions`; it also links out
  to the (unmoved) `/rounds` and `/programmes` routes, which is why those left the sidebar. Cards are
  filtered by role, so the hub is shown to everyone. `/users` is now a redirect to `/settings/team` —
  it was the old all-in-one "Organisation" screen
- `src/routes/api/auth.$.ts` — BetterAuth handler (GET + POST)
- `src/routes/api/apply.ts`, `api/submit-report.ts` — public API-key-authed ingest endpoints
- `src/routes/api/round.$roundId.ts`, `api/rounds.ts` — public round metadata
- `src/routes/api/admin.*.ts` — `/api/admin/*` endpoints for the admin app (`x-admin-token` gated,
  helpers in `src/server/admin/http.ts`)
- `src/server/fns/` — server functions (TanStack Start server-side, called from routes)

## Feature modules (each: `src/lib/<x>` pure logic, `src/server/<x>` IO)
- **custodianScore** — Anthropic-scored application quality (0–100 + per-criterion detail)
- **dueDiligence** — registry checks against Charity Commission + Companies House
- **deprivation** — delivery-area → IMD decile context via postcodes.io + `deprivation_areas`
- **fieldMapping / reportMapping** — ingest payload → canonical fields (rules, then AI fallback)
- **reportAnalysis** — AI analysis of received reports (summary, alignment, impact quantity)
- **bankVerification** — level-1 UK modulus check (offline), surfaced in Finance
- **budget** — budget-line types/helpers; `validators/` — zod schemas shared client/server
