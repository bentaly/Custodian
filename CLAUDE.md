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
- **Logs**: Workers Logs is on for both Workers (`[observability]` in `wrangler.toml`). Read them in
  the dashboard → Workers & Pages → the worker → Observability. Retention is short (3 days on Free,
  7 on Paid), so check soon after a failure. This is where `runInBackground`'s
  `[background] <label> failed:` lines land — the only record of why a background pipeline died.
  `npx wrangler tail` streams the same logs live when you can reproduce on demand.

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
2. `pnpm db:generate`. For a **rename**, drizzle asks whether a column was renamed vs dropped+added — answer _rename_ so it emits `ALTER ... RENAME COLUMN` (drop+add loses data). `generate` is local-only; CI never runs it.
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

Required secrets: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `CHARITY_COMMISSION_KEY`, `COMPANIES_HOUSE_KEY`, `ANTHROPIC_API_KEY` (AI "Custodian score" scoring AND field-mapping AI fallback; both degrade gracefully if absent — scoring → `pending`, mapping → `needs_review`), `ADMIN_API_TOKEN` (shared secret gating the `/api/admin/*` field-mapping endpoints), `FROM_EMAIL`
(the sender, `Name <box@custodian.fund>` — the verified Resend domain is the **apex**
`custodian.fund`, which is where the DKIM key lives; `send.custodian.fund` is only the
bounce/return-path subdomain, so never put it in a From address. Set in both Workers but **not** in
`.env`, so local sends fall back to `onboarding@resend.dev`, which Resend only delivers to the
account owner's own address; set it locally before testing any outbound mail).

The admin app (`admin-app/`) must be built with `VITE_ADMIN_TOKEN` equal to the main app's `ADMIN_API_TOKEN`, and `VITE_API_BASE` pointing at the target main app. Locally these live in `admin-app/.env.local` (gitignored); in Cloudflare they're build-env vars on the admin project. `VITE_APPLY_API_KEY` is optional and quite different in kind — a **foundation's** `cust_sk_…` key, not a platform secret — used by the Testing screen and by "Edit & resend" so a test submission can be sent without generating a key first. It must belong to a client on the backend `VITE_API_BASE` names.

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
  on the spot, and since `users.client_id` is nullable that insert _succeeds_, minting a clientless
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

- **Invite link** → `/sign-up?invite=<token>` — password sign-up _or_ "Continue with Google". Claiming
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
check because the token _is_ the proof.

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
- Test/dev submitters live on the admin app's **Testing** screen; the key is entered once there
  (or baked in as `VITE_APPLY_API_KEY`) and shared by all of them — see "The admin app" below.
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

## Canonical field tiers

Every field in `src/lib/fieldMapping/canonical.ts` carries a `tier` saying what its absence costs.
A two-state model (required / optional) shipped a real bug, so the middle tier is load-bearing:

- **`required`** (9 fields) — no application without it. Unresolved → the ingest holds at
  `needs_review`. Derived as `REQUIRED_CANONICAL_KEYS`.
- **`one_of`** — belongs to a group in `REQUIRED_ONE_OF_GROUPS` (today just
  `[charityNumber, companyNumber]`) of which at least one member must resolve. Neither is required
  alone — an applicant may be a charity, a company, or both — but with **neither** there is no
  register to check, so due diligence can never run. As two plain optionals this promoted silently
  and an admin saw an application that looked screened and never had been. Enforced in **both**
  `ingest.ts` (step 6) and `resolve.ts` (`oneOfIssues`) — a reviewer must not be able to wave
  through what the pipeline held.
- **`expected`** — promotes without it, but a feature is degraded, so the field carries a
  `degrades` string that is **shown on the application** ("Not captured" panel) rather than left
  silent. Holding these would be disproportionate: a foundation that doesn't ask for a delivery
  area shouldn't have every submission stuck in a queue.

`fieldGaps()` (`src/lib/fieldMapping/gaps.ts`) turns this metadata into the list the application
screen renders. The principle: **a lost field must never be indistinguishable from a question the
foundation never asked** — that equivalence is what made the original bug invisible for days.

`/settings/submissions` renders the tiers straight from the registry, so the published spec cannot
drift from the mapper. The admin review queue gets group membership via `oneOfGroup` on
`/api/admin/canonical-fields` rather than inferring it from `tier`.

## The admin app (`admin-app/`)

A separate Vite SPA (not part of the main app's routing), Cloudflare Access-gated, talking to
`/api/admin/*` with `x-admin-token`. It is where **we** operate the platform: clear held
submissions, provision foundations, teach field mappings, and send test data.

Navigation is grouped rather than a flat tab row — **Queues** (Overview, Applications, Grant
reports), **Configuration** (Foundations, Field mappings), **Testing** (Send test data) — with a
count on each queue so a stuck submission announces itself. Shared pieces live in `src/ui.tsx`;
`src/queues.ts` holds one shared fetch of the three *active* statuses feeding both the sidebar
counts and the Overview, so a badge and the list behind it can never disagree.

### Blockers: why a submission is held

`processIngest` knows exactly why it is holding a row and then discards it, storing a bare
`needs_review`. **`src/server/fieldMapping/diagnose.ts`** (and its report twin) re-derives the
reasons from what IS stored — raw payload, resolved map, round programme, status — and
`/api/admin/ingests` attaches them to every row as `blockers`. The admin app renders them as the
"why this is here / what to do" panel on each card, and buckets the queues by blocker code.

Re-deriving rather than storing a column is deliberate: the answer can never go stale against the
registry or the validators, and rows held before this existed explain themselves too. Blockers are
**advice to a human, never a gate** — the gates stay in `ingest.ts` and `resolve.ts`.

The codes worth knowing: `pipeline_running` vs `pipeline_stalled` (same `received` status, but one
wants patience and the other only moves via Reprocess — five minutes apart, `STUCK_AFTER_MS`);
`programme_unknown` vs `programme_not_open` (rename the programme vs reopen the round — different
remedies, so not one "out of round" message); `required_unmapped`; `one_of_unmet`; `invalid_value`;
and reports-only `grant_unmatched`. **`invalid_value` is the one that justifies the module**: a
field that maps but holds a value the validators reject leaves a mapping grid that looks complete,
so the row sat in `needs_review` looking ready to promote with nothing anywhere saying otherwise.

If you add a blocker code, add it to `IngestBlockerCode` in `diagnose.ts` **and** `BlockerCode` in
`admin-app/src/api.ts` — the admin app cannot import the main app's source.

### Naming trap: `awardId`, not `grantId`

`computeGrantCandidates` stores `matchCandidates` keyed on **`awardId`**, and `ResolveReportSchema`
accepts **`awardId`**. The admin app declared and posted `grantId`, which typechecked on both sides
and silently broke the whole report queue: no candidate ever matched a grant, nothing was ever
pre-selected or badged, and every resolve came back "Grant not found for this client". The UI says
"grant" because that is the domain word; the wire says `awardId`.

## Route structure

- `src/routes/_authenticated.tsx` — layout + auth guard for all protected routes
- `src/routes/_authenticated/*.tsx` — dashboard, applications (+detail), shortlist, awards
  (+detail), finance (+detail), reports (+detail), rounds (+detail), programmes (+detail),
  insights, profile, and the Settings hub
- **Shortlist** (`/shortlist`) — the board's decision screen: three `MiniKpi` cards (proposed spend
  by programme / spend against the round-programme budget incl. what is already committed / where the
  vote has got to), then a vote card per shortlisted application. Trustees get Approve-Decline
  buttons; admins get per-trustee toggles only when `allowAdminVoting` is on (an admin has no vote of
  their own — see `castVote`). `/shortlist/set-up-awards` is the admin-only award set-up flow (below)
- **`RoundSelect`** (`src/components/ui`) — the round pill Applications and Shortlist share. There is
  deliberately **no "all rounds"** option: these screens are about one round's decisions, and totals
  summed across rounds are meaningless. Shortlist's `beforeLoad` redirects to the most recent round
  when the search param is absent. Screen headers put the `<h1>` first and the round pill on the row
  beneath it — match that on any new round-scoped screen
- **Settings** (`/settings`) — a card-grid hub for everything that is configuration rather than daily
  work. Sub-pages: `team`, `giving-strategy`, `voting`, `award-letter`, `api-keys`, `submissions`; it also links out
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
- **fieldMapping / reportMapping** — ingest payload → canonical fields (rules, then AI fallback).
  The application registry (`src/lib/fieldMapping/canonical.ts`) grades each field by what its
  absence costs — see "Canonical field tiers" below
- **reportAnalysis** — AI analysis of received reports (summary, alignment, impact quantity)
- **bankVerification** — level-1 UK modulus check (offline), surfaced in Finance
- **awardLetter** — the letter a grantee is emailed when awarded. `src/lib/awardLetter` renders it
  (text-only `{{token}}` template, no markup passthrough — a foundation's template is emailed to
  third parties); `src/server/awardLetter.ts` stores + sends it
- **budget** — budget-line types/helpers; `validators/` — zod schemas shared client/server

## Awards: shortlist → grant

`createAwards` (`src/server/fns/awardSetup.ts`) is the **only** path that mints an award; the old
single-grant `generateAward` + `AwardSetupDrawer` were removed with the batch flow. It takes terms
shared by the batch (start date, reporting milestones, whether the standard conditions apply) plus a
per-grant amount / purpose / special condition / schedule. Each grant is written in **its own**
`db.batch`, so one failing its majority check doesn't roll back the others — the response reports
per-grant outcomes.

- Award letters are **snapshots**: rendered at set-up from the then-current template and schedule and
  stored verbatim in `award_letters` (one row per award, unique on `awardId`). Nothing re-renders a
  stored letter — editing the template later must not rewrite what a grantee was sent, and "resend"
  posts the same bytes. Readable + resendable from the award detail screen.
- Sending is **background** (`runInBackground`) but the outcome is recorded on the row
  (`draft` / `sent` / `failed` + `failureReason`), because a silent failure would leave a charity
  un-notified with nothing on screen to say so.
- "Looks like it came from the foundation" = their name in the **From display name** + their address
  in **Reply-To** (`client_profiles.award_letter_sender_name` / `_reply_to`). We cannot put their
  address in From: DMARC aligns against the From domain, so it would fail auth and land in spam.
  Genuinely sending from their domain needs per-client Resend domain verification (DKIM/SPF DNS) —
  not built; the settings/schema are shaped so it can drop in.
- Template + standard conditions default to the built-ins in `src/lib/awardLetter/template.ts`;
  a foundation overrides them at `/settings/award-letter`. **NULL means "use the built-in"** (so they
  keep picking up improvements), which is why resetting the editor to the default writes NULL, not
  the current text.
- Call it an **Award letter**, never a "grant letter".
