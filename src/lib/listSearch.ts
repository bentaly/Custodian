// ─── List URL state, and the back arrow that restores it ─────────────────────────
//
// Applications, Awards and Reports each keep their whole reading position in the URL —
// which round and programme is being looked at, the status filter, the search text, the
// sort, the page. That is what makes a filtered list a thing you can bookmark and send
// to a colleague.
//
// It is also what the DETAIL screens' back arrows hand back. The convention, applied by
// all three pairs, is three lines:
//
//   1. the list route validates its search with the parser below;
//   2. the row (and the link inside it) carries that search onto the detail route,
//      `search: (prev) => parseXSearch(prev)`;
//   3. the detail route validates the SAME shape and passes it to `DetailHeader`'s
//      `backSearch`.
//
// Before this, every back arrow threw the state away — `backSearch={{ roundId:
// undefined }}` — and the list then redirected to its own default round, so going back
// from a grant in last year's round silently moved the reader to this year's. Every key
// is optional and anything unrecognised is dropped, so a detail screen opened from
// somewhere with no list behind it (the dashboard, a grant, header search) parses to
// `{}` and its arrow lands on the plain list, exactly as before.
//
// Pure: these parse `Record<string, unknown>` off the router and nothing else. Keep the
// parsers total — never throw on a hand-edited or stale URL, degrade to the default.

import { ApplicationStatus, ScoreBand } from './validators/application'

export type SortDir = 'asc' | 'desc'

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** A non-empty string, or nothing. Empty is the same as absent in every filter here. */
function text(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

/** A `yyyy-mm-dd` day, or nothing — the form both date-window ends are stored in. */
function isoDay(v: unknown): string | undefined {
  return typeof v === 'string' && ISO_DAY.test(v) ? v : undefined
}

/** One of a known set, or nothing: a retired sort key or status degrades to the default. */
function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | undefined {
  return allowed.includes(v as T) ? (v as T) : undefined
}

function sortDir(v: unknown): SortDir | undefined {
  return v === 'asc' || v === 'desc' ? v : undefined
}

/** Page 1 is absent from the URL rather than `page=1`, so it round-trips to nothing. */
function pageNo(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 1 ? n : undefined
}

// ─── Applications ────────────────────────────────────────────────────────────────

export type ApplicationsSortKey =
  | 'organisation'
  | 'amount'
  | 'received'
  | 'status'
  | 'score'
  | 'dueDiligence'

export const APPLICATIONS_SORT_KEYS: ApplicationsSortKey[] = [
  'organisation',
  'amount',
  'received',
  'status',
  'score',
  'dueDiligence',
]

export type ApplicationsSearch = {
  roundId?: string
  programmeId?: string
  status?: ApplicationStatus
  scoreBand?: ScoreBand
  tag?: string
  q?: string
  /** Inclusive submission-date window (`yyyy-mm-dd`). */
  from?: string
  to?: string
  sortBy?: ApplicationsSortKey
  sortDir?: SortDir
  page?: number
}

export function parseApplicationsSearch(search: Record<string, unknown>): ApplicationsSearch {
  return {
    roundId: text(search.roundId),
    programmeId: text(search.programmeId),
    status: oneOf(ApplicationStatus.options, search.status),
    scoreBand: oneOf(ScoreBand.options, search.scoreBand),
    tag: text(search.tag),
    q: text(search.q),
    from: isoDay(search.from),
    to: isoDay(search.to),
    sortBy: oneOf(APPLICATIONS_SORT_KEYS, search.sortBy),
    sortDir: sortDir(search.sortDir),
    page: pageNo(search.page),
  }
}

// ─── Awards ──────────────────────────────────────────────────────────────────────

export type AwardStatus = 'active' | 'completed' | 'cancelled'
const AWARD_STATUSES: AwardStatus[] = ['active', 'completed', 'cancelled']

// No 'status' key: the lifecycle pill moved into the Paid column, and sorting by a
// column that no longer has a header is unreachable. Status is still a FILTER — the
// server keeps accepting the old key, so a stale bookmarked URL degrades to the
// default order rather than erroring. 'geography' likewise: it is the row's subline,
// and reachable through search.
export type AwardsSortKey =
  | 'organisation'
  | 'programme'
  | 'round'
  | 'awarded'
  | 'amount'
  | 'paid'
  | 'duration'

export const AWARDS_SORT_KEYS: AwardsSortKey[] = [
  'organisation',
  'programme',
  'round',
  'awarded',
  'amount',
  'paid',
  'duration',
]

export type AwardsSearch = {
  roundId?: string
  programmeId?: string
  tag?: string
  status?: AwardStatus
  q?: string
  from?: string
  to?: string
  sortBy?: AwardsSortKey
  sortDir?: SortDir
  page?: number
}

export function parseAwardsSearch(search: Record<string, unknown>): AwardsSearch {
  return {
    roundId: text(search.roundId),
    programmeId: text(search.programmeId),
    tag: text(search.tag),
    status: oneOf(AWARD_STATUSES, search.status),
    q: text(search.q),
    from: isoDay(search.from),
    to: isoDay(search.to),
    sortBy: oneOf(AWARDS_SORT_KEYS, search.sortBy),
    sortDir: sortDir(search.sortDir),
    page: pageNo(search.page),
  }
}

// ─── Reports ─────────────────────────────────────────────────────────────────────

export type ReportsTab = 'to_review' | 'reviewed' | 'awaiting'

export type ReportsSortKey = 'organisation' | 'programme' | 'round' | 'report' | 'received' | 'due'

export const REPORTS_SORT_KEYS: ReportsSortKey[] = [
  'organisation',
  'programme',
  'round',
  'report',
  'received',
  'due',
]

export type ReportsSearch = {
  tab?: ReportsTab
  programmeId?: string
  roundId?: string
  tag?: string
  q?: string
  from?: string
  to?: string
  sortBy?: ReportsSortKey
  sortDir?: SortDir
  page?: number
}

export function parseReportsSearch(search: Record<string, unknown>): ReportsSearch {
  return {
    // `to_review` is the default and so has no value in the URL — it is the work sitting
    // with you, and the app lands on its first tab everywhere else. Which also means a
    // report opened from that tab carries no `tab` back, and lands on it again.
    tab: oneOf(['reviewed', 'awaiting'] as const, search.tab),
    programmeId: text(search.programmeId),
    roundId: text(search.roundId),
    tag: text(search.tag),
    q: text(search.q),
    from: isoDay(search.from),
    to: isoDay(search.to),
    sortBy: oneOf(REPORTS_SORT_KEYS, search.sortBy),
    sortDir: sortDir(search.sortDir),
    page: pageNo(search.page),
  }
}

// ─── Partnerships ────────────────────────────────────────────────────────────────

export type PartnershipsTab = 'to_action' | 'awaiting' | 'closed'

export type PartnershipsSortKey =
  | 'organisation'
  | 'programme'
  | 'source'
  | 'status'
  | 'dueDiligence'
  | 'logged'

export const PARTNERSHIPS_SORT_KEYS: PartnershipsSortKey[] = [
  'organisation',
  'programme',
  'source',
  'status',
  'dueDiligence',
  'logged',
]

export type PartnershipsSearch = {
  tab?: PartnershipsTab
  programmeId?: string
  source?: string
  tag?: string
  q?: string
  /** The archive, which is a destination rather than a tab — see the screen. */
  archived?: true
  sortBy?: PartnershipsSortKey
  sortDir?: SortDir
  page?: number
}

export function parsePartnershipsSearch(search: Record<string, unknown>): PartnershipsSearch {
  return {
    // `to_action` is the default and carries no value in the URL, as every other list's
    // first tab does. It is also the only tab that is WORK, so landing anywhere else
    // would be answering a question nobody asked.
    tab: oneOf(['awaiting', 'closed'] as const, search.tab),
    programmeId: text(search.programmeId),
    source: text(search.source),
    tag: text(search.tag),
    q: text(search.q),
    // Present-or-absent rather than true/false: `archived=false` in a URL is the same
    // state as no archive at all, and two spellings of one state is how a back arrow
    // ends up somewhere the reader has never been.
    archived: search.archived === true || search.archived === 'true' ? true : undefined,
    sortBy: oneOf(PARTNERSHIPS_SORT_KEYS, search.sortBy),
    sortDir: sortDir(search.sortDir),
    page: pageNo(search.page),
  }
}
