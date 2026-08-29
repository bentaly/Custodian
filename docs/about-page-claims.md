# The About page makes claims the software does not support

> Moved out of CLAUDE.md on 2026-08-29: this is an open risk register with an owner, not
> project context, and it does not need to be in every prompt. Alexandra's to rewrite —
> see the Notion page "GDPR & ICO — Where We Actually Stand".


`src/routes/about.tsx` — the public "Trust by design" section. Verified against the code
on 2026-08-27 and line numbers re-checked 2026-08-29; the Residency line has since been softened but these have not, and the
copy is Alexandra's to rewrite (see the Notion page "GDPR & ICO — Where We Actually
Stand"). Recorded here so a change to any of them is recognised as making a published
claim true rather than as ordinary copy editing:

- **`about.tsx:514`** — "An immutable, tamper-proof audit trail records **every action**".
  `audit_log` is an ordinary Postgres table holding **19 action types, all of them
  changes** (award, decline, shortlist, comment, payment, bank details, milestones, keys,
  invitations). It records nobody's READS, has no hash chain and no append-only
  constraint. "Every action" and "tamper-proof" are both wrong; "records every change we
  consider material" is right.
- **`about.tsx:515-516`** — "structured tooling supports **subject-access and erasure**
  requests". There is none. The only file in the repo that mentions erasure is
  `about.tsx` itself. There is not even a way to remove a team member from a foundation.
- **`about.tsx:516-517`** — "Full data-governance documentation … available for review".
  There is no privacy policy route, no terms route, and no retention rule anywhere in the
  code — `application_ingests.raw_payload` keeps the original submission, bank details
  included, forever, alongside the promoted application.
- **`about.tsx:531`** — "Processing: **ICO registered**." A statement of regulatory status.
  Registration was still an open action on the GDPR page as of 2026-08-24.

The footer still reads "Coming soon", so nobody has relied on any of it yet — which is
what makes this cheap to fix now and expensive to fix later.

