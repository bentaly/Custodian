// ─── Audit vocabulary ────────────────────────────────────────────────────────
//
// Pure half of the audit log: the set of things that can be recorded, and which of
// them the dashboard shows. The IO lives in `src/server/audit.ts`.
//
// It is here rather than beside the writer because BOTH sides need it — the server
// writes rows, and the dashboard route decides what to render — and a route must not
// import a module that pulls `getDb` into the browser bundle.

/**
 * Every human action the platform records.
 *
 * Deliberately narrow in one direction and broad in another. It records *people doing
 * things*: it does NOT record external submissions (a charity applying or reporting) or
 * system/AI events (scoring, due diligence), which are derivable from their own
 * timestamped rows and aren't "someone did something" moments.
 *
 * Within that, it records everything — including the actions nobody wants on a
 * dashboard. See `FEED_ACTIONS`.
 */
export type AuditAction =
  // ── Decisions on an application ──────────────────────────────────────────
  | 'application_awarded'
  | 'application_declined'
  | 'application_shortlisted'
  | 'application_commented'
  // A comment was removed. The log NEVER loses the fact that something was said and
  // then unsaid — deleting the audit row alongside the comment would make the trail
  // agree with whoever most recently changed their mind, which is the one thing an
  // audit trail exists not to do.
  | 'application_comment_deleted'
  // An admin supplied a charity/company number that was never captured, so the
  // grantee could finally be screened. A statement about who is being funded, not a
  // typo fix, which is why it is in the feed rather than only in the column.
  | 'application_registration_set'
  // An admin recorded a vote on a trustee's behalf (only possible where the client has
  // turned admin voting on). The vote itself is stored against the TRUSTEE — that is
  // whose vote it is — so without this row and `application_votes.recorded_by_user_id`
  // there is nothing anywhere distinguishing a vote a trustee cast from one an
  // administrator entered for them. A trustee voting as themselves is not recorded
  // here: the vote row already carries them, and it isn't an unusual event.
  | 'application_vote_recorded_by_admin'

  // ── Money ────────────────────────────────────────────────────────────────
  // The account a grant is paid into was changed by hand on the payment panel. The one
  // edit in the app that moves money somewhere else, so it is a fact about the grant
  // rather than a correction to a field.
  | 'grant_bank_details_changed'
  // An instalment was ticked off as paid, or that tick was taken back. The names say
  // "recorded"/"reversed" rather than "paid"/"unpaid" because that is what actually
  // happened here: the money moves in the foundation's banking, and what Custodian
  // holds is somebody's statement that it did. The instalment row keeps the date the
  // money went; only these say WHO said so and when they said it.
  //
  // The reversal is not an afterthought — a payment marked paid and then unmarked is
  // exactly the shape an auditor looks for, and recording only the tick would leave the
  // trail claiming money went out that the schedule says is still outstanding.
  | 'grant_payment_recorded'
  | 'grant_payment_reversed'
  // A scheduled instalment's amount or due date was changed. Moving £50,000 two
  // quarters down the schedule is the same class of act as ticking one off, and was
  // the obvious gap left by recording only the tick.
  | 'grant_payment_amended'

  // ── Reporting obligations ────────────────────────────────────────────────
  // What a grantee owes, and when. Changing or removing a milestone changes the
  // obligation itself, which is why the three are distinct: "who dropped the
  // requirement for a final report?" is a question the log should answer directly.
  | 'grant_report_milestone_added'
  | 'grant_report_milestone_changed'
  | 'grant_report_milestone_removed'
  // An admin signed off (or un-signed) a received report as reviewed.
  | 'grant_report_reviewed'
  // The award letter was sent to the grantee again — an outbound communication to a
  // third party, possibly to a different address than the original.
  | 'award_letter_resent'

  // ── Access and configuration (no application) ────────────────────────────
  // A key that lets anything on the internet submit applications AS the foundation,
  // and the revocation that stops it.
  | 'api_key_created'
  | 'api_key_revoked'
  // Somebody was granted access to the tenant at a role. Roles are set at invitation
  // and never edited afterwards, so this IS the access-control event.
  | 'invitation_sent'

/**
 * The subset the dashboard's "Lately" panel shows.
 *
 * The log records everything; the feed is a reading of it, not a mirror. The line is
 * whether the whole team would want to know: decisions on applications, and money or
 * reporting moving on a grant. Housekeeping (rescheduling an instalment, editing a
 * milestone), corrections (a deleted comment) and configuration (keys, invitations)
 * are recorded and stay out of the panel — a dashboard that lists every milestone edit
 * teaches people to stop reading it, and a feed nobody reads is worse than none.
 *
 * The filter is applied in SQL, not after the fetch: "Lately" takes the most recent
 * rows, so filtering afterwards would let a run of key rotations return eight rows that
 * all render as nothing and leave the panel looking empty.
 */
export const FEED_ACTIONS = [
  'application_awarded',
  'application_declined',
  'application_shortlisted',
  'application_commented',
  'application_registration_set',
  'application_vote_recorded_by_admin',
  'grant_bank_details_changed',
  'grant_payment_recorded',
  'grant_payment_reversed',
  'grant_report_reviewed',
] as const satisfies readonly AuditAction[]

/** An action the "Lately" panel knows how to render. */
export type FeedAction = (typeof FEED_ACTIONS)[number]
