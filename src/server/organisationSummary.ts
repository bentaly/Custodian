import { sql, type AnyColumn } from 'drizzle-orm'
import { SUMMARY_PREVIEW_CHARS } from '../lib/organisationSummary'

/**
 * Who the applicant is, for the tooltip on an organisation's name in every list
 * (`ui/OrganisationCell`). The same choice the application screen makes: the applicant's
 * own answer to "tell us about your organisation", else the register's description of
 * the charity (`organisationProfile.activities`).
 *
 * Cut in SQL, one character past the preview, so the list carries a few hundred bytes a
 * row rather than whole answers: the list queries select only what a row draws, since
 * whole rows took /applications past the Worker's CPU limit (2026-10-06). The extra
 * character is how `summaryPreview` knows there was more.
 *
 * Takes the columns rather than importing the table because a relational query aliases
 * it, and a column from the bare table would name the wrong alias inside `extras`.
 */
export function organisationSummarySql(cols: {
  organisationSummary: AnyColumn
  organisationProfile: AnyColumn
}) {
  // Whitespace collapsed BEFORE the cut, or an answer full of line breaks would be cut
  // short of the preview and then read as complete once the client tidied it.
  return sql<string | null>`left(regexp_replace(coalesce(
    nullif(btrim(${cols.organisationSummary}), ''),
    nullif(btrim(${cols.organisationProfile}->>'activities'), '')
  ), '\\s+', ' ', 'g'), ${SUMMARY_PREVIEW_CHARS + 1})`
}
