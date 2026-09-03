# Custodian — Claude Code Context

## What this project is

Grant management platform for philanthropic organisations. Clients (charitable foundations /
family offices) manage funding rounds, programmes, applications, and users through a single app.

**How this file works:** it holds what you need BEFORE opening a file — operational rules,
cross-cutting invariants, and naming traps. The *why* behind a feature lives in its module
header comment, which is thorough and is the authority. Where a section names a file, read it.

## Stack

- **Framework**: TanStack Start (React, file-based routing via `src/routes/`)
- **Auth**: BetterAuth (`src/server/auth.ts`) — Google OAuth + email/password
- **ORM**: Drizzle ORM — schema at `drizzle/schema.ts`, migrations at `drizzle/migrations/`
- **Database**: Neon (PostgreSQL, serverless driver `@neondatabase/serverless`)
- **Runtime**: Cloudflare Workers (deployed via `wrangler`)
- **Email**: Resend (`src/lib/email.ts`)
- **Package manager**: pnpm

## Deployment

- **Production URL**: `https://custodian.fund` — a Cloudflare custom domain on the prod Worker.
  `custodian.bental.workers.dev` is the same Worker's default subdomain, not a redirect: both
  hostnames serve identical code and data. Use `custodian.fund` in anything a foundation sees;
  the workers.dev host is still live and still needed by the admin app's `VITE_API_BASE`.
- **Deploy method**: push to `master` → GitHub Actions (`.github/workflows/ci.yml`) runs
  typecheck → build → `wrangler deploy`.
- Do NOT run `npx wrangler deploy` manually unless testing outside CI.
- Cloudflare secrets are managed via `npx wrangler secret put <KEY>` — NOT in `.env` for production.
- **Logs**: Workers Logs is on for both Workers (`[observability]` in `wrangler.toml`) — dashboard
  → Workers & Pages → the worker → Observability. Retention is short (3 days Free, 7 Paid), so
  check soon after a failure. `runInBackground`'s `[background] <label> failed:` lines land here
  and are the only record of why a background pipeline died. `npx wrangler tail` streams live.

## Local development

```sh
pnpm dev          # vite dev server (localhost:5174)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
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

**Never use `db:push`.** It applies schema changes without recording them in
`drizzle.__drizzle_migrations`, which makes `db:migrate` fail later. Removed from `package.json`.

## Staging & migration workflow

Two deployed environments, both fed from `master`:

- **prod** — `custodian` Worker, prod Neon branch.
- **staging** — `custodian-staging` Worker (`custodian-staging.bental.workers.dev`), Neon
  `staging` branch. Mirrors prod (same code, own per-env secrets); not behind Cloudflare Access.

**Local dev runs against staging** — `.env`'s active `DATABASE_URL` is the staging branch (the
prod string is commented out). So `pnpm dev` / `db:migrate` / `db:seed` / `db:studio` all act on
staging; prod is never touched locally.

A push to `master` runs CI, which **migrates then deploys staging, then migrates then deploys
prod** — schema always lands before the code that needs it. **Do not run `db:migrate` against
prod manually; CI owns prod migrations.**

### Default migration procedure

1. Edit `drizzle/schema.ts`.
2. `pnpm db:generate`. For a **rename**, drizzle asks renamed vs dropped+added — answer _rename_
   so it emits `ALTER ... RENAME COLUMN` (drop+add loses data). `generate` is local-only.
3. `pnpm db:migrate` to apply to **staging**; verify the app still works. Staging holds real
   prod-snapshot data, so failures (adding `NOT NULL` to a populated table, bad casts) surface
   there, not on prod.
4. **Commit the generated `.sql` + the `meta/` snapshot & journal with the schema and code.** CI
   only applies migrations present in the repo — a missing file means prod code ships against a
   schema it doesn't have.
5. Push → CI migrates + deploys prod.

### Destructive changes (drop / rename / add NOT NULL / type change)

`master` deploys both Workers at once, so for a few seconds old code runs against the new schema.
Additive changes are safe. For destructive ones use **expand/contract** across separate pushes:

- **Rename** `a`→`b`: push 1 add `b` + write both + backfill; push 2 move reads to `b`; push 3 drop `a`.
- **Drop**: stop using the column in one push, drop it in a later push.

Only skip this for a deliberately-accepted brief blip on this low-traffic app (prefer off-hours).

## Environment variables

Local: `.env` (loaded via `dotenv/config`). Production: Cloudflare secrets — `npx wrangler secret list`.

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `CHARITY_COMMISSION_KEY`, `COMPANIES_HOUSE_KEY`,
`ANTHROPIC_API_KEY`, `ADMIN_API_TOKEN`, `CRON_SECRET`, `FROM_EMAIL`, `GOOGLE_MAPS_API_KEY`.

Traps:

- **`BETTER_AUTH_URL` must be `https://custodian.fund` in production.** Wrong value → Google
  OAuth returns "Account not linked".
- **`FROM_EMAIL`** — the verified Resend domain is the **apex** `custodian.fund`, where the DKIM
  key lives. `send.custodian.fund` is only the bounce/return-path subdomain; never put it in a
  From address. Set in both Workers but **not** in `.env`, so local sends fall back to
  `onboarding@resend.dev`, which Resend delivers only to the account owner. Set it locally
  before testing outbound mail.
- **`CRON_SECRET`** fails closed — unset means every call to the digest endpoint is refused.
- **`ANTHROPIC_API_KEY`** absent → scoring degrades to `pending`, field mapping to `needs_review`.
- **`GOOGLE_MAPS_API_KEY`** is the deprivation place lookup, and is the ONLY geocoder — the
  postcodes.io `/places` and Nominatim fallbacks were deleted. Restrict the key to the Geocoding
  API (not by IP: Workers egress IPs aren't stable) and cap Requests-per-day in the Cloud console.
  Absent or refused → the place branch degrades to **`pending`, never `unresolvable`**: the first
  is "not run yet" and is what `rerun-deprivation.ts --pending` returns for, the second is a
  verdict on the applicant's text that a grants officer reads and acts on. A postcode input never
  calls Google at all.
- The admin app is built with `VITE_ADMIN_TOKEN` = the main app's `ADMIN_API_TOKEN`, and
  `VITE_API_BASE` pointing at the target main app (`admin-app/.env.local` locally; Cloudflare
  build-env vars in the cloud). `VITE_APPLY_API_KEY` is different in kind — a **foundation's**
  `cust_sk_…` key, not a platform secret — and must belong to a client on that `VITE_API_BASE`.

## Server-side patterns

- **No `db.transaction()`** — `getDb()` uses the neon-http driver, where `transaction()` throws at
  runtime. Use `db.batch()` for atomic multi-statement writes.
- **Writes that belong together go in ONE `db.batch()`.** An application insert and the ingest-row
  update pointing at it are one fact: `processIngest` only acts on rows still at `received`, so a
  failure between two separate statements leaves a promoted application no ingest points at, and
  the next attempt builds a second one.
- **Tenancy**: every server fn scopes to the caller's client. Lists go through
  `visibleRoundProgrammeIds(user)` + `intersectScope` (`src/server/scope.ts`); fetch-by-id through
  `assertClientAccess` / `assertApplicationAccess`. `null` scope = superadmin, unrestricted. Any
  query filtering on a cross-tenant column (e.g. `organisationName`) must ALSO scope by client.
- **Post-response work has a 30-second ceiling.** `runInBackground` (`src/server/background.ts`)
  wraps `ctx.waitUntil`, and Cloudflare cancels waitUntil work 30s after the response on every
  plan — silently, because workerd ABANDONS the promise rather than rejecting it, so `.catch`
  never runs. Tasks carry a 25s deadline of their own so cancellation surfaces as a reported error.
- **Anything longer goes on the queue**: `enqueue` (`src/server/pipelineQueue.ts`) → `PIPELINE_QUEUE`
  binding → `worker-entry.js`'s `queue()` handler → `/api/internal/pipeline` (gated by
  `CRON_SECRET`, since that file cannot import `src/`). 15 minutes per consumer, backoff, DLQ.
  `max_batch_size = 1` is required on the Free plan: the 50-subrequest cap is per invocation and
  one submission spends 13–20 (every Neon query is an HTTPS request). Degrades to `runInBackground`
  when the binding is absent (local dev).
- **Degrade gracefully**: AI features without `ANTHROPIC_API_KEY`, rate limiting without its
  binding, and email without Resend all no-op or fall back rather than failing the request.
- **jsonb does not preserve object key order.** Postgres normalises it (length, then bytewise), so
  a payload read back from `raw_payload` is in an order the sender never used. Anything that needs
  the sender's order must capture it at the decode boundary — see `application_ingests.field_order`,
  written in `saveIngest`, and `applications.submitted_fields`.

## Data model summary

- **clients** — tenant (charitable_foundation | family_office); users and rounds belong to a client
- **users** — extend BetterAuth user; `role` (superadmin | admin | trustee | finance), one client.
  `superadmin` is platform-level (no `client_id`); `admin` runs a foundation; `trustee`
  reads/comments/votes; `finance` is a trustee plus the payment schedule (instalment edits,
  marking paid) — never grant decisions. Default `trustee`, on the columns and BetterAuth's
  `defaultRole`. Old `manager`/`contributor`/`observer` folded in by migration 0049.
  **The trustee/finance line is enforced on READS as well as writes** (`canSeePayments`,
  `src/lib/roles.ts`): bank columns are withheld from `getApplication`, and `/finance` has a route
  guard. Three places must agree (nav, route guard, server fn); only the last is a boundary — the
  other two exist so nobody is shown a door that redirects them away.
- **user_avatars** — profile photos, kept off the `users` row (which `getAuthUser` selects on every
  authenticated call); `users.image` holds the `/api/avatar/$userId?v=<hash>` URL
- **client_profiles** — per-tenant settings (mission statement, admin-voting toggle)
- **rounds** ↔ **programmes** via **round_programmes** (budget, grant duration, impact unit per
  pairing); applications hang off a round-programme
- **applications** — one row per submission; responses/budget lines in jsonb, plus AI columns
- **application_comments** / **application_votes** — discussion + trustee voting (majority gates awards)
- **awards** → **award_instalments** + **report_schedule** — a grant minted from an awarded application
- **reports** — received grant reports (from `/api/submit-report`); **report_ingests** is its holding table
- **application_ingests** + **field_mappings** — `/api/apply` holding table and learned mappings
- **deprivation_areas** — IMD decile lookup (seeded by `scripts/seed-deprivation.ts`)
- **audit_log** — human actions with actor; feeds the dashboard "Lately" feed
- **invitations** — token-based invitation flow
- **api_keys** — per-client secret keys gating `/api/apply`
- **import_batches** — onboarding data import, makes it reversible
- **annual_budgets** + **annual_budget_lines** — a year's grant-making plan; a line's NULL
  `programme_id` is core costs. **Stated, not derived from `round_programmes.budget`** — a
  foundation may hold money back from rounds, and the reconciliation between the two is the point
- **bank_balance_readings** — append-only ledger of the grant account's balance, each with the date
  it was TRUE (not when it was typed). Never updated; a correction is a new row
- BetterAuth tables: `sessions`, `accounts`, `verifications` (do not modify manually)

## The money rule: what a cancelled grant counts toward

Six modules compute money and must agree, because a foundation reads two of them side by side.
Stated on `listFinanceGrants`, enforced in `grantsQuery`:

- **paid** — INCLUDES cancelled. The money left the building; paid history must reconcile against
  the foundation's own ledger.
- **committed / awarded / giving** — EXCLUDES cancelled. A withdrawn grant is not money committed.
- **outstanding / overdue / due soon** — EXCLUDES cancelled. There is nothing left to pay.

Finance, Rounds and Shortlist applied it; the dashboard and Insights did not, and were caught by
the 2026-08-27 audit — one foundation's dashboard reported £186,166.66 outstanding where Finance
reported £165,666.66, the unpaid half of a cancelled grant. `getDashboard` now derives
`liveAwardScope` once (with `paidToDate` deliberately on the wider scope); `getInsights` filters
cancelled out of `items` rather than at a dozen `reduce` call sites.

`buildSchedule` folds the rounding remainder into the final instalment so a split sums to the
award exactly, and `createAwards` re-checks that server-side (0.005 tolerance).

The sixth module is the **annual budget panel** (`src/server/finance/budget.ts`), and it is the
first to print committed and paid *in the same bar*, which forces a case the rule never had to
answer: a grant cancelled after a part-payment has paid money `committed` no longer counts, so
`committed - paid` goes negative. The budget answer is **`used = max(committed, paid)`** — what the
year's allocation no longer has, whichever way the money left. With no cancellations it is simply
`committed`, so the screen still reconciles against Finance. Lives in `src/lib/annualBudget.ts`
with the test that pins it.

**"Committed" means two different things and both are correct.** The dashboard's round meters count
`shortlisted` OR `awarded` — the pipeline, because that panel is about a round filling up. Finance
and the budget panel count awarded-and-not-cancelled — decisions, because those are about money
owed. The two meters look almost identical on screen; a bar that moved when somebody *shortlisted*
an application would tell a trustee they had spent money they had not committed. Do not blur the
labels, and do not reuse one rollup for the other.

## Conventions and naming traps

- **British English** in all copy and identifiers ("Organisation", not "Organization").
- Call it an **Award letter**, never a "grant letter".
- **`awardId`, not `grantId`, on the wire.** `computeGrantCandidates` stores `matchCandidates`
  keyed on `awardId` and `ResolveReportSchema` accepts `awardId`. The admin app once declared and
  posted `grantId`, which typechecked on both sides and silently broke the whole report queue. The
  UI says "grant" because that is the domain word; the wire says `awardId`.
- **Adding a blocker code** means adding it to `IngestBlockerCode` (`server/fieldMapping/diagnose.ts`)
  **and** `BlockerCode` (`admin-app/src/api.ts`) — the admin app cannot import the main app's source.
- Buttons firing async actions disable while pending; reset in `finally`.
- The repo is **not** oxfmt-clean — `pnpm format` rewrites ~20 unrelated files. Format only what
  you touched.

## Feature modules

Each is `src/lib/<x>` (pure logic) + `src/server/<x>` (IO). The module header comment carries the
design rationale; this list is a map, not a summary.

- **custodianScore** — Anthropic-scored application quality (0–100 + per-criterion detail). It is
  30–58s of model time against ~8s for the rest of the ingest, so it does NOT run inside the
  submission: `createApplicationFromCanonical` with `score: 'queued'` writes the application
  immediately and `src/server/applications/score.ts` fills it in from its own queue message. The
  reviewer's Confirm path scores **inline**, because someone is watching. **`queued` is distinct
  from `pending`**: `pending` means no score is coming (no API key).
- **dueDiligence** — registry checks against Charity Commission + Companies House. Returns
  **`no_registration`** (its own status, not `review`, so it stays out of the dashboard flag count)
  when there is no number to screen.
- **deprivation** — delivery-area → IMD decile. Three layers, each doing what only it can:
  **Google Geocoding** (free text → a place, a coordinate, and `types` saying what KIND of thing
  it matched), **postcodes.io** (postcode → LSOA code; coordinate → ward/LAD/region GSS codes —
  the only free source of these, and Google never returns one), **`deprivation_areas`** (codes →
  decile spread). `reportingLevel` picks the geography from Google's `types`, not from
  bounding-box size. A venue reports the ward containing it. A settlement reports its **district**
  when its name IS the district's (Preston, Stockport) and its **ward** when it names somewhere
  inside one (Birkenhead in Wirral) — that comparison replaced a size threshold that was wrong
  both ways, reporting Stockport's most deprived ward as the whole borough and all of Wirral for
  Birkenhead. A **county reports its police force area** (`deprivation_areas.pfa_name`, backfilled
  by `scripts/backfill-pfa.ts` from the ONS LAD25→PFA25 lookup): ONS publishes no current
  ceremonial-county lookup, and PFAs carry the exact names foundations use — "Merseyside" is the
  right five districts. **Matched only on an EXACT name match**, because some forces merge
  counties, so "Buckinghamshire" against "Thames Valley" fails and falls back to the region
  exactly as before. Never a wrong answer, sometimes no better one. Scotland and NI are null (one
  national force each). Only town-vs-city still turns on footprint, because Google types Potters
  Bar and Leeds alike.
- **fieldMapping / reportMapping** — ingest payload → canonical fields (rules, then AI fallback)
- **reportAnalysis** — AI analysis of received reports
- **bankVerification** — level-1 UK modulus check (offline), surfaced in Finance
- **awardLetter** — `src/lib/awardLetter` renders (text-only `{{token}}` template, no markup
  passthrough — a foundation's template is emailed to third parties); `src/server/awardLetter.ts`
  stores + sends
- **dataImport** — `/settings/data-import`, onboarding a foundation's existing grants
- **financeDigest** — the Monday payments email
- **annualBudget** — `src/lib/annualBudget.ts` (the reconciliation rules) + `src/server/finance/
  budget.ts` (the screen's queries) + `src/server/fns/budget.ts` (both writes). The budget is set in
  Settings (a yearly decision); the bank balance is recorded on **Finance → Balance & budget** (an
  observation off a statement), where **Update balance is the one and only entry point** — it must
  exist before there is any balance to show, or a foundation's first reading can never be entered.
  The two halves are independent: budget-without-balance and balance-without-budget are both
  complete screens. Clearing every line DELETES the budget row, and the read side ignores a header
  with no lines, so "£0 of £0 with no meters" is unreachable; hiding the feature *without* losing
  the figures is the Settings switch. `src/lib/financialYear.ts` derives the year from
  `client_profiles.financial_year_end_month` (a MONTH, because "our year end is 31 March" is what a
  grant-maker actually knows; default 3)
- **budget** — budget-line types/helpers; **validators/** — zod schemas shared client/server

## Public submission auth

A foundation's intake posts to `POST /api/apply` with `Authorization: Bearer <api key>`. The key
resolves the owning client — there is **no `clientId` in the body**. **The request body IS the
payload**: a flat object of the foundation's own field names → values, no reserved top-level keys.
JSON or form-encoded. Every field, including the foundation's own reference (→
`externalApplicationId`), is mapped like any other. The only door-level check is "non-empty
object"; real validation runs downstream on `CreateApplicationSchema`.

- Keys live in `api_keys`: only a **SHA-256 hash** is stored (plus `last4`); plaintext is shown
  once. Helpers in `src/server/apiKeys.ts`, management fns in `src/server/fns/apiKeys.ts`.
  UI at **Settings → API keys**; `/settings/submissions` renders the canonical registries so the
  published docs cannot drift from the mapper.
- **A form platform posts to its own route**: `POST /api/webhooks/typeform/<token>`. Typeform lets
  you set an address and nothing else, so the credential travels in the PATH. That is a second
  `api_keys.kind` (`webhook`, prefix `cust_wh_…`), and `resolveToken` makes the kind part of the
  LOOKUP so a leaked webhook URL can never be replayed as a Bearer header. Answers **200**, not
  202 — Typeform's delivery log is read by a person.
- **Envelopes are flattened at the decode boundary** (`src/lib/submissionEnvelope`), by SHAPE not
  by route, so nothing downstream knows they exist. Three keys are synthesised because a form
  cannot supply them (`Submission ID`, `Form name`, `Submitted at`) but they do NOT count toward
  "did anything arrive" — an answerless Typeform test delivery must 400.
- **Every body is capped at `MAX_SUBMISSION_BYTES` (1 MB)** in `parseSubmissionPayload`, the single
  decode boundary all endpoints share. Over it is **413**, deliberately distinct from the 400 for
  a body that decoded to no fields. `Content-Length` is where it is really enforced.
- Missing/invalid/revoked key → 401. Rate-limited two ways (`src/server/rateLimit.ts`): per-IP
  before auth, per-client after. Degrades open.
- **`POST /api/submit-report`** is the report-side twin: same auth + 202 + background pipeline, own
  canonical registry (`src/lib/fieldMapping/reportCanonical.ts`) and holding table. Auto-links to a
  grant only on an exact `externalApplicationId` match; heuristics are suggestions only.
- **Legacy**: budget links captured during the Make period are dead URLs (Typeform's Responses API
  returns a bearer-authed path; the raw webhook returns the openable one). If another platform
  hands back an unreachable URL, re-derive that from the stored payload — never store it as a column.

## Canonical field tiers

Every field in `src/lib/fieldMapping/canonical.ts` carries a `tier` saying what its absence costs.
A two-state model (required / optional) shipped a real bug, so the middle tiers are load-bearing.

- **`required`** (8) — no application without it. Unresolved → the ingest holds at `needs_review`.
- **`one_of`** — a group in `REQUIRED_ONE_OF_GROUPS` of which at least one member must resolve.
  **The list is empty today** but the machinery stays wired; enforcement lives in BOTH `ingest.ts`
  (step 6) and `resolve.ts` (`oneOfIssues`) and the two must keep agreeing — a reviewer must not be
  able to wave through what the pipeline held.
- **`expected`** — promotes without it, but a feature is degraded, so the field carries a `degrades`
  string **shown on the application** ("Not captured" panel). Pairs answering the same question go
  in `EXPECTED_ONE_OF_GROUPS` and report only when neither arrived.
- **`optional`** — promotes and nothing is degraded, so nothing is said anywhere. The line against
  `expected` is whether you can NAME what stops working. Today only `bankName`.
- **A tier change alone is not enough**: `CreateApplicationSchema` gates the assembled application
  separately, so leaving `min(1)` there holds the row regardless of tier.

The principle, and the reason the whole thing exists: **a lost field must never be
indistinguishable from a question the foundation never asked.** `fieldGaps()`
(`src/lib/fieldMapping/gaps.ts`) turns the metadata into what the application screen renders.

## The admin app (`admin-app/`)

A separate Vite SPA (not part of the main app's routing), Cloudflare Access-gated, talking to
`/api/admin/*` with `x-admin-token`. It is where **we** operate the platform: clear held
submissions, provision foundations, teach field mappings, send test data. Nav is grouped —
Queues / Configuration / Testing — with a count per queue. Shared pieces in `src/ui.tsx`;
`src/queues.ts` holds one shared fetch feeding both the sidebar counts and Overview.

- **Blockers** (`src/server/fieldMapping/diagnose.ts` + its report twin) re-derive why a row is
  held from what IS stored, rather than storing a column — so the answer can never go stale
  against the registry, and rows held before it existed explain themselves too. Blockers are
  **advice to a human, never a gate**; the gates stay in `ingest.ts` and `resolve.ts`.
- **Confirming a mapping REWRITES the application** — `resolveIngest`'s confirm branch re-applies
  the mapping via `updateApplicationFromCanonical` and re-runs derived features where their inputs
  changed. A `complete` ingest can be re-confirmed. **The gate is money: once a grant has been
  awarded the mapping is frozen** (`already_awarded`), since the award letter was written from
  those figures. An invalid or empty mapping is refused rather than partially applied.
- **`rerunDueDiligence` takes optional `charityNumber` / `companyNumber`** and writes them first —
  the only way out of the one dead end due diligence has (both columns NULL reads the same nothing
  however often it is pressed). Allowed after an award on purpose. Writes an
  `application_registration_set` audit row.

## Onboarding data import

`/settings/data-import` (admin-only) brings a foundation's existing grants in at onboarding.
`src/lib/dataImport` is pure, `src/server/fns/dataImport.ts` is IO.

- **Scoped by lifecycle, not "all history"**: the grants that still owe money or a report. Old
  application text, votes and retrospective scores are never imported.
- One .xlsx workbook, three sheets (Grants / Payments / Reports) joined on the foundation's own
  reference. **The template is generated per client** after their programmes exist, so
  Programme/Round/Status are dropdowns of real data; a hidden `_Custodian` sheet fingerprints the
  file, and one built for another tenant is rejected.
- **Excel validation does not fire on PASTE**, so `match.ts` resolves unmatched values:
  exact-after-normalisation applies silently, anything else is proposed with a reason and
  confirmed per DISTINCT value. Heuristics never auto-link.
- **Three things an import must never do**, all easy to add by reflex: send award letters (127
  charities emailed about grants from 2019), write `audit_log` rows (the feed would show 127
  awards "made today"), or go through `createAwards` (which enforces a trustee majority — right
  for a decision, meaningless for a fact). Due diligence and deprivation are not auto-run either.
- **`import_batches` makes it reversible.** Every created row carries `importBatchId`;
  `rollbackImport` removes them unless a comment, vote, award letter or non-import report exists.
  Re-uploading the same reference REPLACES rather than duplicating — that is the phasing mechanism.
- Imported rows are **marked permanently**, because their blank score/DD/votes read as lost data
  otherwise. ExcelJS is **browser-side** via dynamic import; the server re-validates everything.

## Weekly payments digest

A Monday email to finance users listing what needs paying. Cloudflare Cron Trigger →
`POST /api/cron/finance-digest` → Resend. `src/lib/financeDigest` pure, `src/server/financeDigest` IO.

- **The cron IS wired** — `[triggers] crons = ["0 8 * * 1"]` on prod, with
  `[env.staging.triggers] crons = []` overriding the inheritable key so staging never fires, and
  `bridgeEnv` lifted out of `fetch` in `worker-entry.js` so `scheduled` gets `DATABASE_URL`.
  Drivable by hand with `?dryRun=1`, which renders the whole run and returns it without sending.
- **`0 8 * * 1` is UTC with no BST correction** — 9am London in summer, 8am in winter. Accepted:
  the requirement is "in the morning", and pinning the local hour costs a second trigger out of five.
- **The cron has no session**, so `digestWindow` REQUIRES a `clientId` and filters
  `awards.client_id` directly. There is deliberately no "all clients" variant to reach for by
  accident: the failure mode is emailing one foundation's payment schedule to another's officer.
- **`finance_digest_sends` is a receipt, not a claim** — written after Resend accepts. Cron
  Triggers are at-least-once and the endpoint gets curled by hand, so a re-run must finish whoever
  was missed rather than leave rows saying "sent" to people who got nothing.
- **A week with nothing due sends nothing.** No "all clear" — a recurring email that is usually
  empty gets filtered, and the week it finally matters is the week it goes unread.
- **Overdue is listed first and counted separately**, including in the subject line.
- **The window is 7 days, not `DUE_SOON_DAYS` (30)** — this is the week's work, not a planning
  horizon. Undated ("TBC") instalments are excluded.
- **`users.weekly_finance_digest` is nullable and NULL is not "off"** — it means "has never chosen"
  and resolves to the role default (`digestDefaultOn`), same convention as
  `client_profiles.award_letter_template`. An unsubscribe writes an explicit `false`.
- **One-click unsubscribe** (`/api/digest-unsubscribe`) is an HMAC over the user id keyed on
  `BETTER_AUTH_SECRET`, no expiry (the link must work in a six-month-old email). GET shows a
  confirmation, POST writes, so a scanning mail proxy cannot unsubscribe someone.

## Awards: shortlist → grant

`createAwards` (`src/server/fns/awardSetup.ts`) is the **only** path that mints an award. It takes
terms shared by the batch plus a per-grant amount / purpose / special condition / schedule. Each
grant is written in **its own** `db.batch`, so one failing its majority check doesn't roll back the
others — the response reports per-grant outcomes.

- UI is **`AwardWizard`** (`src/components/shortlist/`), a modal over the Set up awards queue
  (Terms → Grant details → Award letters). Validation **gates rather than reports**: an
  unreconciled split disables Continue on the step that owns the field. Each step is gated only by
  what it can fix. At least one reporting milestone is required.
- **A grant can carry several bespoke conditions**, newline-joined in the single `special_condition`
  column; `renderAwardLetter` makes each line its own numbered clause. Anything reading that column
  back must split on newlines.
- Award letters are **snapshots** — rendered at set-up and stored verbatim in `award_letters`.
  Nothing re-renders a stored letter: editing the template later must not rewrite what a grantee
  was sent, and "resend" posts the same bytes.
- Sending is background, but the outcome is recorded on the row (`draft`/`sent`/`failed` +
  `failureReason`) — a silent failure would leave a charity un-notified with nothing on screen.
- "Looks like it came from the foundation" = their name in the **From display name** + their
  address in **Reply-To**. We cannot put their address in From: DMARC aligns against the From
  domain, so it would fail auth and land in spam. Per-client Resend domain verification is not
  built; the settings/schema are shaped so it can drop in.
- Template + standard conditions default to `src/lib/awardLetter/template.ts`; a foundation
  overrides at `/settings/award-letter`. **NULL means "use the built-in"**, so resetting the editor
  to the default writes NULL, not the current text.

## Auth

- BetterAuth lazy-initialised in `src/server/auth.ts` (prevents Workers module poisoning on missing
  env vars); `worker-entry.js` bridges Cloudflare env bindings into `process.env`.
- Three ways in, all on `/sign-in`: email + password, Google OAuth, and an emailed 6-digit code
  (`emailOTP`). Plus a code-based password reset.
- **`requireLocalEmailVerified: false` is load-bearing.** BetterAuth's default is `true`, and local
  sign-up leaves `email_verified = false` (no verification email is wired), so on the default an
  existing password user clicking "Continue with Google" would be refused with `account_not_linked`
  instead of linked.
- **`emailOTP` runs with `disableSignUp: true`.** Without it the plugin signs up any unknown email
  on the spot, and since `users.client_id` is nullable that insert *succeeds*, minting a clientless
  user with a live session and no invitation. A code is **not** a way to accept an invite.
- Codes: 6 digits, 5-minute expiry, 3 attempts, stored **hashed** in `verifications`. An unknown
  email gets `{success: true}` and no email — BetterAuth won't confirm whether an account exists,
  so sign-in copy must stay "if an account exists…". OTP resolves by **email only**, no provider
  check, and sets `email_verified = true` as a side effect.
- A Google-only user adding a password goes through the code-based reset;
  `emailAndPassword.sendResetPassword` is deliberately not configured, so
  `/request-password-reset` returns `RESET_PASSWORD_DISABLED`.
- Google Console authorized redirect URI: `https://custodian.fund/api/auth/callback/google`
  (workers.dev, staging and localhost are registered alongside).

## Invite-only onboarding

An invitation creates **no user row** — only an `invitations` row (email, token, `clientId`, role,
7-day expiry). The `users` row appears when the invitee registers with `client_id = null`; a user
is attached to a tenant only by `claimPendingInvite` (`src/server/invites.ts`). Two routes in:

- **Invite link** → `/sign-up?invite=<token>`. Claiming by token also sets `email_verified = true`:
  possessing a token mailed to that address is the same proof a verification email would give.
- **Google** → the invitee ignores the link and hits "Continue with Google". OAuth never calls
  `completeRegistration`, so `getMe` auto-claims a pending invite **by email** for any tenant-less
  non-superadmin.

**The tokenless email match requires `emailVerified` — do not remove it** (see `invites.test.ts`).
`/api/auth/sign-up/email` is public and accepts any address without proving it, so without the gate
anyone who knew an invited address could sign up as it, let `getMe` hand them the invite, and land
inside the tenant at the invited role. Token claims skip the check because the token *is* the proof.

No valid invite → `client_id` stays null → `_authenticated`'s guard redirects to `/no-access`.
Superadmins legitimately have no `client_id` and are exempt. Signups without an invite still
create an inert account (no tenant, bounced to `/no-access`); closing that off entirely would mean
creating users server-side and setting `emailAndPassword.disableSignUp`, which the invite page's
`authClient.signUp.email` call currently depends on — so it is a known gap, not an oversight.

## Security headers

Set in `worker-entry.js` (`withSecurityHeaders`), not in the app, because that wrapper is the only
layer that sees **every** response — SSR pages, server functions, public API routes, static assets.

- `frame-ancestors 'none'` + `X-Frame-Options: DENY` are the load-bearing pair: this app has
  one-click destructive actions behind a session. Plus `object-src 'none'`, `base-uri 'self'`,
  `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` denying
  everything, and HSTS at one year.
- **Headers are only set where absent, never overwritten** — the admin endpoints set their own CORS
  and `/api/avatar` its own `Cache-Control`.
- **There is deliberately no `script-src`.** A real one needs nonces threaded through TanStack's
  hydration, and a CSP that breaks the page gets switched off rather than fixed. HSTS omits
  `includeSubDomains` and `preload` for the same reason.

## Route structure

- `src/routes/_authenticated.tsx` — layout + auth guard; `_authenticated/*.tsx` — dashboard,
  applications (+detail), shortlist, awards (+detail), finance (+detail), reports (+detail),
  rounds, programmes, insights, profile, Settings hub
- `src/routes/api/auth.$.ts` — BetterAuth handler; `api/apply.ts`, `api/submit-report.ts` — public
  key-authed ingest; `api/admin.*.ts` — `x-admin-token` gated (helpers in `src/server/admin/http.ts`)
- `src/routes/api/round.$roundId.ts`, `api/rounds.ts` — round metadata for the admin app.
  **Cross-tenant by design and therefore `x-admin-token` gated**, not public, despite the names.
  Columns are named explicitly so widening the schema cannot silently widen the response.
- `src/server/fns/` — server functions

Structural decisions worth knowing before adding a screen:

- **Finance is two routes wearing one header** (`components/finance/FinanceHeader`) — Payments /
  Balance & budget. Same reasoning as Shortlist below: those header tabs are NAVIGATION, while the
  To pay / Paid pair inside the grants card is a FILTER over one list, and the two must not be
  confused. Balance & budget started as a collapsible panel above the payments table, which put a
  quarterly question (can we cover what we promised?) permanently on top of a daily one and pushed
  the grants table ~900px down. The tab pair is hidden entirely when
  `client_profiles.show_balance_and_budget` is false — **a visibility switch that touches no data**,
  because the only alternative on offer was "delete your budget to hide it".
- **Shortlist is two routes wearing one header** (`components/shortlist/ShortlistHeader`) — To vote
  / Set up awards. The tabs are NAVIGATION, not a filter. A screen's own action goes through
  `actions`, immediately LEFT of the tabs — the right-hand cluster reads outwards, this screen's
  action first, then the pair that switches screens. It used to sit on its own line beneath, on the
  reasoning that one screen's thing should not share a row with both screens' tabs, and it read as
  a button hanging off the bottom of the tabs with nothing to belong to. `FinanceHeader` follows
  the same rule; keep the two consistent. Set up awards is admin-only. Both tab counts come from
  one place (`listAwardCandidates` returns `shortlistedCount`) so they cannot disagree.
- **Scores are stated on one scale** — composite out of 100, criteria out of 10, RAG-banded at
  80/60 and 7/4. One score quoted on two scales is something a board will argue about.
- **Rounds and Programmes have no detail route.** Each is created and edited in a dialog over the
  list; `saveRound` / `saveProgramme` write the whole thing in one call, and a round's programme
  array is a REPLACEMENT, not a patch. A round's budget is always **derived** (the sum of its
  programme allocations). Both are **archive only** — `deleteRound` / `deleteProgramme` were
  removed, because a round's applications and awards are the record of a decision. Which rounds a
  programme is funded in is set in the ROUND dialog, next to the budget that decision is about.
- **`RoundSelect`** — the round pill Applications and Shortlist share. There is deliberately **no
  "all rounds"** option: totals summed across rounds are meaningless. Screen headers put the `<h1>`
  first and the round pill on the row beneath.
- **Programme colour** (`src/lib/programmeColours.ts`) — `programmes.colour` holds a lowercase
  `#rrggbb`. Assigned **server-side** on create so two admins can't be handed the same one.
  Deliberately not aliases of the semantic tokens: a contrast fix to `--color-danger` must not
  repaint somebody's programmes. Nullable with no backfill. **Never use these as TEXT** — at
  OKLCH L 0.76 they sit at 2.0–2.3:1 on white. Lightness is flat across the ten; chroma is
  **capped, not flattened** (`RAMP_C` is a ceiling), because flattening it caps every hue at what
  the tightest one on the wheel can reach and turns the warm half to mustard. Regenerating the ten
  means a migration too — the colour is stored on the row, and one off the current ten reads as
  "Custom" and can be handed out twice (see `0074_programme_colour_ramp_reweight`).
- **Settings** (`/settings`) — a card-grid hub for configuration rather than daily work; sub-pages
  `team`, `giving-strategy`, `voting`, `award-letter`, `api-keys`, `submissions`, `data-import`, `budget`.
  It links out to `/rounds` and `/programmes`, which is why those left the sidebar. Cards are
  filtered by role. `/users` is now a redirect to `/settings/team`.
