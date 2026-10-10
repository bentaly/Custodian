// The organisation summary on the shortlist card, and its short version.
//
// The card says who an applicant is before what they want, from the applicant's own
// description, else the Charity Commission's account of its activities (a company's
// register entry has none). Either can run to a full paragraph, so the scoring call
// also writes `applications.organisation_summary_short`: one sentence of the same,
// which the card prints instead, with the full text a click away.
//
// Made only where the source is too long for the card anyway: a short source is
// already its own summary, and a model's rewording of it would only drift from it.
// Like `grant_purpose` it is written by a successful score and by nothing else, so an
// edit to the summary (or a re-run of due diligence) leaves it until the next score.

/** Past this many characters a summary no longer fits two lines of the card. */
export const SHORT_SUMMARY_FROM = 200

/** The text the card summarises: the applicant's own, else the register's. */
export function organisationSummarySource(
  organisationSummary: string | null | undefined,
  activities: string | null | undefined,
): string | null {
  return organisationSummary?.trim() || activities?.trim() || null
}

/** Whether a source is long enough to be worth a short version. */
export function needsShortSummary(source: string | null | undefined): boolean {
  return (source?.trim().length ?? 0) > SHORT_SUMMARY_FROM
}
