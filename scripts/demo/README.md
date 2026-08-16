# The demo dataset

A complete, representative foundation — **The Wrenfield Foundation** — with two rounds,
four programmes, forty applications, nine grants, their payment schedules and their
grant reports. Built so the app can be looked at, and demonstrated, as it behaves in
real use rather than through accumulated test rows.

Everything hangs off one `clients` row, so the whole dataset can be removed exactly.

## Commands

```sh
pnpm demo:seed       # foundation, programmes, rounds, staff, API key   (free, ~10s)
pnpm demo:apply      # 40 applications through the ingest pipeline      (free on replay)
pnpm demo:decide     # statuses, votes, comments, grants, letters       (free, ~30s)
pnpm demo:report     # 8 grant reports through the report pipeline      (free on replay)
pnpm demo:snapshot   # record the pipeline output for replay            (free)
pnpm demo:teardown   # remove the tenant and everything scoped to it    (free)

pnpm demo:all        # seed → apply → decide → report, in order
```

Order matters: `apply` needs `seed`, and `decide` and `report` need `apply`.

## Replay: why a rebuild is free

`snapshot/pipeline.json` is a **recording of a real pipeline run** — every Custodian
score, due diligence result, deprivation decile and report analysis in it was produced
by the live pipeline from the narratives in `lib/applications.ts` and `lib/reports.ts`.

Because the fixture is static, the pipeline returns the same assessment every time, so
`demo:apply` and `demo:report` **replay the recording by default** and finish in seconds
for nothing. That is what makes it cheap to reshape rounds, award statuses or payment
schedules — none of that changes the assessment underneath.

Re-run the real thing with `--live` when the narratives have changed, then
`pnpm demo:snapshot` to re-record. The snapshot stores a hash of the two fixture files
and warns loudly when a replay no longer matches the text it was captured from — a
replayed score describing narratives that have since been edited would be a quiet lie.

A full live run is roughly **$2–3** on `claude-sonnet-4-6`. Replaying costs nothing.

### Cost, when running live

Payloads are keyed by **canonical field name**, so the rule-based matcher resolves them
on an exact-key match and the AI mapping fallback is almost never invoked — which keeps
a live run down to the scoring and analysis calls alone.

Both steps are **resumable**: a reference that already has an ingest row is skipped, so
an interrupted run costs nothing to finish. `--limit=N` runs only the first N, which is
the right way to sanity-check a change before paying for the whole set.

### Re-running

`demo:seed` tears the tenant down first, so it is idempotent — but it destroys the
applications, which means paying for `demo:apply` again. To reshape the _decisions_
(statuses, votes, discussion, grants, schedules, budgets) without re-paying, edit
`lib/applications.ts` / `lib/data.ts` and re-run **`demo:decide`** on its own: it clears
and rebuilds only its own layer, and re-asserts the round budgets from the fixture.

## Layout

| File                  | What it holds                                                               |
| --------------------- | --------------------------------------------------------------------------- |
| `lib/data.ts`         | The foundation, programmes, rounds, budgets, staff, applicant organisations |
| `lib/applications.ts` | The forty applications, their narrative content, and their outcomes         |
| `lib/reports.ts`      | The eight grant reports                                                     |
| `lib/teardown.ts`     | Tenant-scoped deletion, ordered to respect the RESTRICT foreign keys        |
| `lib/shared.ts`       | Date offsets, the database guard, script scaffolding                        |
| `probe-registers.ts`  | Throwaway: verifies charity/company numbers against the live registers      |
| `probe-bank.ts`       | Throwaway: finds modulus-valid account numbers for each sort code           |

## Things that are deliberate

**Dates are offsets, never calendar dates.** Every date is resolved at seed time from a
number of days relative to the run. A fixture with absolute dates goes stale within a
month — the open round quietly closes, and the point of the dataset evaporates.

**Applicants are fictional; their registration numbers are real.** Due diligence screens
by number and never cross-checks the name, so real numbers mean the DD panel is genuinely
populated with live filing history, while no real charity is ever shown on screen as
declined or late with a report.

**Grantee contacts are plus-addressed on one real inbox** (`team+riverbank@…`), so award
letters and notifications all land with us while each grant still shows a distinct
address. Staff logins use `@wrenfield.example`, an RFC 2606 reserved domain that cannot
receive mail at all.

**Award letters are written directly, not through `createAwards`.** That path enforces a
trustee majority and _emails the grantee_ — right for a decision being made, wrong for a
fact being recorded. Letters are rendered with the real renderer and stored as `sent`
with a backdated timestamp; nothing is delivered.

**The imperfections are on purpose.** One submission is stuck in the admin review queue
(it names a programme that does not exist); one grant's bank details fail the modulus
check; one application has no delivery area, so the "Not captured" panel has something
real to report; one report describes a project that under-delivered, so the alignment
analysis has genuine unmet promises to find. A dataset where everything is clean
demonstrates nothing about how the app handles the state it will actually meet.

**Credentials are written down.** `pnpm demo:seed` writes `CREDENTIALS.local.md`
(gitignored) with every staff login and the API key. The key is only stored hashed, so
it cannot be recovered any other way — set `DEMO_API_KEY` in `.env` to keep one key
across re-seeds.

**Rounds are quarterly**, seasonally named. A single annual round stacks every grant
decision on one date and leaves the dashboard's giving-over-time chart a lone spike; four
a year gives the portfolio a rhythm and spreads the awards across the calendar.

**`demo:decide` will not rebuild grants once reports exist.** `reports.award_id`
cascades, so deleting a grant deletes the report attached to it. Pass `--rebuild-grants`
to override — and expect to re-run `demo:report`.

**`demo:teardown` will not run against production** unless `DEMO_ALLOW_PROD=1` is set.
Local `.env` points at staging; the guard exists so a one-keystroke mistake cannot
delete a tenant's entire history.
