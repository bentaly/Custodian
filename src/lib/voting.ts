// ─── Who votes, and what carries ─────────────────────────────────────────────
//
// The client-side statement of the voting rules. The boundary is
// `countsTowardMajority` (`src/server/members.ts`), which says the same thing in SQL and
// is what actually gates an award; everything here decides what a screen OFFERS and what
// it prints. The two must agree, and they are two because one of them has to run in the
// browser.

/**
 * Does this person hold a vote of their own on applications?
 *
 * Every trustee, plus an admin the foundation has given a vote (`users
 * .votes_on_applications`, set on Settings → Team). Finance is deliberately absent, which
 * is the half of "trustee access, plus the payment schedule" that the role hint does not
 * spell out: never grant decisions. A superadmin sits on nobody's board and never votes
 * either, though they may still record a vote FOR a trustee where the foundation allows
 * proxies, which is a different thing and lives in `castVote`.
 */
export function holdsAVote(person: { role: string; votesOnApplications?: boolean }): boolean {
  return person.role === 'trustee' || (person.role === 'admin' && !!person.votesOnApplications)
}

/**
 * How many yes-votes carry an application: a simple majority of everyone who votes.
 *
 * Stated once because it is printed in two places that a reader will hold against each
 * other — the Shortlist card's "2 votes needed" and the Settings page's "a grant needs 3
 * of them to approve it" — and derived in SQL as `yes * 2 > voters`, which is the same
 * rule written so it needs no rounding. Zero voters is not a majority of nothing: with
 * nobody on the board nothing can be carried, and the screens say so rather than
 * printing a threshold of 1 that no one can reach.
 */
export function majorityOf(voterCount: number): number {
  return voterCount > 0 ? Math.floor(voterCount / 2) + 1 : 0
}
