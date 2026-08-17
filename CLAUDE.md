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
A two-state model (required / optional) shipped a real bug, so the middle tiers are load-bearing.
`optional` still exists, but it is now a claim that has to be earned rather than the default
bucket for anything not required:

- **`required`** (8 fields) — no application without it. Unresolved → the ingest holds at
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
- **`optional`** — promotes without it and **nothing is degraded**, so nothing is said anywhere.
  The line against `expected` is whether you can NAME what stops working; if you can't, inventing
  a degradation just prints a complaint on every application and teaches admins to skim the panel.
  Today only `bankName`: the sort code is what identifies the bank and what `checkBankAccount`
  verifies, so the name is read solely to print beside the digits on the payment panel. It was
  `required` until Arete's live form — account name, number and sort code, no bank name, which is
  what real foundation forms look like — held every submission over a field no feature reads. The
  column was always nullable and Finance could always clear it, so `required` was only ever true
  of the ingest. **A tier change alone is not enough**: `CreateApplicationSchema` gates the
  assembled application separately, and leaving `min(1)` there holds the row at `needs_review`
  regardless of tier.

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

### Confirming a mapping REWRITES the application

`resolveIngest`'s confirm branch (an ingest that already has an `applicationId`) does not just
tick the row complete — it re-applies the reviewer's mapping via `updateApplicationFromCanonical`,
and re-runs due diligence / the Custodian score / the deprivation lookup **where their inputs
changed**. It used to discard `input.mapping` entirely, so mapping the charity number the model
missed and pressing Confirm left the column NULL and the application permanently unscreenable —
the mapping equivalent of a lost field, on a screen that said "confirmed".

A `complete` ingest can be re-confirmed too (the mapping stays editable), because a mistake does not
stop being one once the row is filed. The gate is money: **once a grant has been awarded from the
application the mapping is frozen** (`already_awarded`), since the award letter was written from
those figures. An invalid or empty mapping is refused rather than partially applied, so a client
that posts `{}` before the canonical registry loads cannot blank a live application.

### Screening an application that never captured a registration number

`rerunDueDiligence` takes optional `charityNumber` / `companyNumber`. Without them it re-checks
what is on the row; with them it **writes them first**, which is the only way out of the one dead
end due diligence has — with both columns NULL a re-run reads the same nothing and returns `review`
with zero checks however often it is pressed. Surfaced on the application screen exactly where that
message appears, so the fix sits with the problem. Clearing both is refused; supplying them writes
an `application_registration_set` audit row (a statement about who is being funded, not a typo fix).

Two routes reach that dead end and **neither can be fixed upstream**, which is why this exists
despite the one-of gate covering new submissions: a grant imported from a back catalogue arrives
already awarded and deliberately unscreened, and the import treats a missing number as a
degradation rather than a blocker (refusing history is not an option); and anything awarded before
the one-of gate has its mapping frozen by the rule above. Allowed after an award on purpose — a
registration number is not a figure the award letter was written from, and a grantee still
receiving instalments is precisely the one worth screening late.

### Naming trap: `awardId`, not `grantId`

`computeGrantCandidates` stores `matchCandidates` keyed on **`awardId`**, and `ResolveReportSchema`
accepts **`awardId`**. The admin app declared and posted `grantId`, which typechecked on both sides
and silently broke the whole report queue: no candidate ever matched a grant, nothing was ever
pre-selected or badged, and every resolve came back "Grant not found for this client". The UI says
"grant" because that is the domain word; the wire says `awardId`.

## Onboarding data import

`/settings/data-import` (admin-only) brings a foundation's existing grants in at onboarding, so
Finance, Reports and Insights are right on day one rather than pretending their history began then.
`src/lib/dataImport` is the pure half (column registry, matcher, parser, validator + the .xlsx
reader/writer); `src/server/fns/dataImport.ts` is the IO.

- **Scope it by lifecycle, not by "all history".** The pitch is *"start with the grants that still
  owe you money or a report"* — without those the app is actively WRONG (it says nothing is due when
  £400k is scheduled), whereas missing closed grants only makes lifetime totals short. Old
  application text, votes and retrospective scores are deliberately never imported.
- **One .xlsx workbook, three sheets** — Grants / Payments / Reports, joined on the foundation's own
  reference. Payments and reports are one-row-per-item: an ACTIVE grant paid in six instalments
  cannot be described by a single "paid to date" figure, because Finance needs each dated line to
  reconcile. **Completed grants are the exception the workbook now states up front**: they fill in
  the Grants sheet alone, and their money arrives as the lump `Amount paid`. `commitImport` turns
  that into ONE paid instalment dated at the grant's end, because every screen showing money moving
  reads instalments — a figure that lived only on the reconciliation would leave the grant showing
  £0 paid. Itemised rows always win where both exist (a mismatch is a degradation), and the lump
  counts toward `totalPaid` only where there is no schedule, so the total signed off at upload is
  the total seen afterwards.
- **`Received?` on the Reports sheet is the answer, not the date.** A milestone is met by the flag;
  a Yes with no date falls back to the due date, exactly as a payment marked paid with no date
  does. Before it existed a blank date was the only signal, so a foundation that never logged
  arrival dates saw every milestone it had met listed as overdue.
- **The header suffix ("(required)") is not the tier.** `askedAs` in `columns.ts` is the two-state
  "please fill this in" a spreadsheet has room for; `tier` is still what we do when it is missing,
  and they deliberately diverge — "Where the impact happens" is ASKED as required but imports
  without one, because a live application only `expects` a delivery area and history must not be
  held to a stricter rule than today's submissions. `baseHeader` strips the suffix on read, so the
  labelling is never load-bearing: an unrecognised header is dropped, and a dropped column is the
  silent version of a lost field.
- **The template is generated per client** (`buildTemplate`), after their programmes exist, so
  Programme/Round/Status are **dropdowns of their real data**. That is what lets the import skip
  column mapping entirely: a hidden `_Custodian` sheet fingerprints the file (version + clientId), so
  on upload we either recognise it or refuse it. A file built for another tenant is rejected.
- **Excel validation does not fire on PASTE**, and pasting from an old export is exactly what people
  do. So `match.ts` resolves unmatched values: exact-after-normalisation applies silently, anything
  else is *proposed* with a reason ("differs by one character") and confirmed by a human — per
  DISTINCT value, so one click settles every row using it. Same rule as `report_ingests`: heuristics
  never auto-link. No AI — the candidate set is five known strings.
- **Blockers vs degradations** (`validate.ts`) reuses the tier model from the canonical registry for
  the same reason. A missing delivery area states what it costs and imports anyway; holding a whole
  portfolio over it would be disproportionate. The `degrades` wording is shared with the grant screen
  so warning and reality agree.
- **Reconciliation is the step that earns trust** — committed / paid / outstanding, checked against
  their own ledger. Stored on the batch as CONFIRMED, never recomputed.
- **`import_batches` makes it reversible.** Every created row carries `importBatchId`; `rollbackImport`
  removes them unless a comment, vote, award letter or non-import report exists, at which point it is
  live data. An import that cannot be undone gets treated as terrifying, so people stall.
  Re-uploading the same reference REPLACES (delete + reinsert) rather than duplicating — that is the
  phasing mechanism (live grants first, historic later). A batch whose rows a later import replaced
  reads as "replaced by a later import" and offers no Undo.
- **Three things an import must never do**, all easy to add by reflex: send award letters (127
  charities emailed about grants from 2019), write `audit_log` rows (the feed would show 127 awards
  "made today"), or go through `createAwards` (which enforces a trustee majority — right for a
  decision, meaningless for a fact). Due diligence and deprivation are NOT auto-run either: screening
  a back catalogue would be thousands of registry calls. The columns are captured so it can be run
  per grant.
- Imported rows are **marked permanently**. An imported grant has no responses, score, DD trail or
  votes, and those blanks read as lost data unless the row says it predates Custodian.
- Historic impact figures become a `reports` row with `matchMethod = 'import'` and no AI analysis, so
  Insights (which already reads impact from reports) needs no special case.
- ExcelJS is **browser-side** via dynamic import (a ~900KB route chunk) — parsing on the Worker would
  mean pushing a binary through a request body. It is in `optimizeDeps.include` so dev doesn't
  re-optimise mid-flow. The server re-validates everything; the browser is never the authority.

## Route structure

- `src/routes/_authenticated.tsx` — layout + auth guard for all protected routes
- `src/routes/_authenticated/*.tsx` — dashboard, applications (+detail), shortlist, awards
  (+detail), finance (+detail), reports (+detail), rounds, programmes,
  insights, profile, and the Settings hub
- **Shortlist** (`/shortlist` + `/shortlist/set-up-awards`) — **two routes wearing one header**
  (`components/shortlist/ShortlistHeader`): the `<h1>`, then a full-width row of the round pill and
  a `Tabs` pair — To vote / Set up awards. The tabs are NAVIGATION, not a filter, which is why they
  live in the shared header and why anything belonging to one screen alone (To vote's Download PDF)
  goes on its own line beneath it. The Set up awards tab is admin-only and hidden from trustees,
  whose route guard would bounce them anyway. Both tab counts come from one place —
  `listAwardCandidates` returns `shortlistedCount` alongside its rows — so the two numbers cannot
  disagree
- **To vote** — two cards (proposed spend by programme; proposed against each round-programme's
  budget), then a `VoteCard` per shortlisted application, paginated at 10. Trustees get
  Approve/Decline and a "You approved this application · Change vote" state; admins get a
  per-trustee toggle in the roster, and only when `allowAdminVoting` is on (an admin has no vote of
  their own — see `castVote`). Vote pills are past tense — **Approved / Declined / Pending** — they
  are a record of what happened, not an instruction. The decision pill counts DOWN
  (`Last vote needed` / `n votes needed` / `Board approved`), because "how far off is this" is the
  board's actual question. **Comments are a count that opens `CommentsDialog`**, never a bare input:
  a box you can write into without seeing what has already been said produces duplicate notes and
  replies to concerns nobody can read. Due diligence is shown in the meta strip **only when it has
  something to say** — the comps drop it, which is right while it is clear and wrong the moment a
  registry flag exists. The score is stated on the app's one scale — **composite out of 100,
  criteria out of 10**, RAG-banded at 80/60 and 7/4 respectively, as the applications list and
  detail screen state them; the comps drew the composite as `9.1/10` and that was not followed,
  because one score quoted on two scales is something a board will argue about. **Download PDF is
  `window.print()`**, with every card rendered (not just the current page) for the duration, so a
  board pack never silently stops at ten
- **Set up awards** (admin-only) — a `DataTable` of the grants carrying a trustee majority, with
  Programme / Theme / AI-score filters and the dark selection bar. A row click sets up that one
  grant; a multi-selection sets up the batch — both open **`AwardWizard`**, a modal over the queue
  (Terms → Grant details → Award letters). Below it, a **Grants awarded** table of the round's
  existing grants, so "what has this sitting already committed" never means leaving the screen.
  There is no trailing arrow column: the whole row is the affordance
- **Rounds** (`/rounds`) — two cards, Active and Past, of round rows (status pill, dates,
  committed-of-budget, programme count). There is deliberately **no round detail route**: a
  round is a name, two dates and a list of programme budgets, so it is created and edited in
  `RoundDialog` over the list. `saveRound` writes the round AND the exact set of programmes it
  funds in one call — the programme array is a REPLACEMENT, not a patch. A round's budget is
  always **derived** (the sum of its programme allocations); there is no stored total. Retiring
  a round is **archive only** — `deleteRound` was removed, because a round's applications and
  awards are the record of a decision and archiving is the reversible way to say "done with
  this". A programme with applications in the round cannot be dropped from it (FK `restrict`);
  set its budget to £0 instead
- **Programmes** (`/programmes`) — a card per programme (colour swatch, name, round badge,
  summary line, Impact measured in, Themes), edited in `ProgrammeDialog` over the list. Same
  shape as Rounds and for the same reasons: **no detail route**, one `saveProgramme` call,
  **archive only** (`deleteProgramme` removed). Which rounds a programme is funded in is set
  in the ROUND dialog, next to the budget that decision is actually about — which is why
  `addProgrammeToRound` / `removeProgrammeFromRound` / `updateRoundProgramme` are gone too.
  The dialog collects **objectives, criteria and priorities** (`goal`, fed to the Custodian
  score) and no longer collects `description`; `saveProgramme` never writes that column, so
  legacy values survive and still win for the card's summary line
- **Programme colour** (`src/lib/programmeColours.ts`, `ui/ColourPicker`) — `programmes.colour`
  holds a lowercase `#rrggbb`: one of ten presets or a custom pick. The presets are a
  **generated ramp**, not hand-picked: ten hues 36° apart, all at OKLCH lightness 0.68, each
  at the most chroma sRGB allows at that hue. Fixed lightness is the point — no programme's
  colour shouts louder than its neighbour's. (The designer's set at `769:15935` spanned
  L 0.50–0.86; Alexandra chose the ramp over it on 2026-08-12.) Deliberately **not** aliases
  of the semantic tokens — a programme's colour is a label a person chose, and a contrast fix
  to `--color-danger` must not repaint somebody's programmes. Assigned **server-side** on
  create so two admins creating at once can't be handed the same one by stale lists:
  `nextProgrammeColour` takes the first free preset, then past ten **bisects the largest gap
  between the hues already in use** — which is why it beats walking a fixed sequence, since a
  custom pick changes where the space actually is. Duplicates are **discouraged, never
  forbidden**: the picker dims a taken colour and names its owner. The column is nullable with
  no backfill — rows predating it keep the positional colour the screen already drew them in
  (`resolveProgrammeColour`). Never use these as TEXT: at L 0.68 they sit at 2.7–3.4:1 on white
- **`RoundSelect`** (`src/components/ui`) — the round pill Applications and Shortlist share. There is
  deliberately **no "all rounds"** option: these screens are about one round's decisions, and totals
  summed across rounds are meaningless. Shortlist's `beforeLoad` redirects to the most recent round
  when the search param is absent. Screen headers put the `<h1>` first and the round pill on the row
  beneath it — match that on any new round-scoped screen
- **Settings** (`/settings`) — a card-grid hub for everything that is configuration rather than daily
  work. Sub-pages: `team`, `giving-strategy`, `voting`, `award-letter`, `api-keys`, `submissions`,
  `data-import`; it also links out
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

- The UI is **`AwardWizard`** (`src/components/shortlist/`), a modal over the Set up awards queue.
  Payment structure is `1 | 2 | 3 | custom`; **Custom** switches to the per-grant hand-edited split,
  seeded from the rows the shared terms had just produced. **Grant start date and first payment are
  separate fields** (paying a month in arrears is ordinary, and one field cannot express it); only
  the start date reaches the server — the first payment is what the per-grant schedule is built
  from. Validation **gates rather than reports**: an unreconciled split or a missing reporting date
  disables Continue on the step that owns the field, so nothing surfaces as a line of red text over
  the finished letters. Each step is gated only by what it can fix — the amount lives on step 2, so
  a £0 amount must never hold step 1 shut. At least one reporting milestone is **required** (the
  form opens with an empty one). On step 3 the letters are **paged with ‹ ›, one at a time**, not stacked:
  a batch of eight is several thousand words of near-identical text that nobody reads in one scroll.
  The amount stays **editable** there even though the comps show it fixed — awarding less than was
  asked for is ordinary, and every instalment and the letter's total derive from it.
- **A grant can carry several bespoke conditions.** They live newline-joined in the award's single
  `special_condition` column, and `renderAwardLetter` makes **each line its own numbered clause**
  continuing the standard list. Anything reading that column back (the award detail screen) must
  split on newlines — a grant set up with three terms must not read as one paragraph.
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
