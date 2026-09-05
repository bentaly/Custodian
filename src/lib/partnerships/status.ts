// ─── The partnership pipeline, as one table ──────────────────────────────────
//
// Five states, and for each of them the label a foundation reads, the colour it wears,
// and — the part that earns this module — WHOSE MOVE IT IS.
//
// That last column is the whole screen. A pipeline list where every row says a noun
// ("Prospective", "EOI issued") tells a grants officer nothing they cannot see from the
// organisation's name; what they open the screen to find out is which rows are waiting
// on THEM. So each state names the actions available from it, and the list groups by
// who is being waited on rather than by the status alone.
//
// Pure: no database, no React. The server derives tab counts from it and the screen
// derives its pills and buttons from it, which is what keeps a status pill on the list
// and the buttons on the detail screen from disagreeing about what is possible.

export const PARTNERSHIP_STATUSES = [
  'prospective',
  'eoi_issued',
  'eoi_received',
  'invited',
  'declined',
] as const

export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number]

/**
 * Who the pipeline is waiting on.
 *
 * `us` — the foundation has something to do: a prospect nobody has decided about, an
 *        EOI sitting unread.
 * `them` — the ball is with the organisation: an EOI form sent, an invitation to apply
 *        issued. Chase-able, but not work.
 * `closed` — nobody is waiting. Declined, or handed over to an application.
 */
export type PartnershipWaitingOn = 'us' | 'them' | 'closed'

export type PartnershipAction = 'issue_eoi' | 'invite' | 'decline' | 'reopen'

type StatusMeta = {
  label: string
  /** The line under the pill on the detail screen: what this state actually means. */
  description: string
  waitingOn: PartnershipWaitingOn
  /** Semantic token name, resolved to a colour by the screen (`ui/tokens`). */
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger'
  /** Offered from this state, most-likely first. The first is the primary button. */
  actions: readonly PartnershipAction[]
}

export const PARTNERSHIP_STATUS_META: Record<PartnershipStatus, StatusMeta> = {
  prospective: {
    label: 'Prospective',
    description: 'Logged, and nobody has decided anything yet.',
    waitingOn: 'us',
    tone: 'neutral',
    actions: ['issue_eoi', 'invite', 'decline'],
  },
  eoi_issued: {
    label: 'EOI sent',
    description: 'Recorded as sent. Waiting on them to answer.',
    waitingOn: 'them',
    tone: 'info',
    // No `issue_eoi`: it has been issued. Re-sending is a chase, which belongs on the
    // contact rather than in the pipeline's list of moves.
    actions: ['invite', 'decline'],
  },
  eoi_received: {
    label: 'EOI received',
    description: 'They have answered. Waiting on you to read it and decide.',
    waitingOn: 'us',
    tone: 'warning',
    actions: ['invite', 'decline'],
  },
  invited: {
    label: 'Invited to apply',
    description: 'Recorded as invited. Waiting on their application.',
    waitingOn: 'them',
    actions: ['decline'],
    tone: 'success',
  },
  declined: {
    label: 'Not pursuing',
    description: 'Closed. Reopening puts them back at the top of the pipeline.',
    waitingOn: 'closed',
    tone: 'danger',
    actions: ['reopen'],
  },
}

/**
 * The verb on the button, and the sentence written into the timeline when it is
 * pressed. Both live here so the history cannot describe an action differently from the
 * button that caused it.
 *
 * **The two correspondence actions say "Mark … as", and the wording is load-bearing.**
 * Custodian does not send the EOI form or the invitation — the admin does, from their
 * own address, so the reply lands in their inbox. These buttons used to open a
 * `mailto:` and move the status in one gesture, which meant closing the draft without
 * sending still left the record asserting that a form "has gone out". A `mailto:` is
 * handed to the operating system and never reports back, so the app cannot ever know.
 *
 * "Mark as" is therefore not hedging, it is the accurate verb: pressing it is the
 * ADMIN stating what they did, which is the same kind of fact as every other entry in
 * this module's history ("introduced by James Hartley at the May board dinner"). It
 * also leaves room for the real thing — if Custodian ever sends the EOI through Resend
 * as it sends award letters, that line will read "sent by Custodian" and be visibly a
 * different claim sitting in the same timeline.
 */
export const PARTNERSHIP_ACTION_META: Record<
  PartnershipAction,
  { label: string; /** Resulting status. */ to: PartnershipStatus; destructive?: boolean }
> = {
  issue_eoi: { label: 'Mark EOI as sent', to: 'eoi_issued' },
  invite: { label: 'Mark as invited', to: 'invited' },
  decline: { label: 'Not pursuing', to: 'declined', destructive: true },
  reopen: { label: 'Reopen', to: 'prospective' },
}

/**
 * Is this a move the pipeline allows from where the record currently is?
 *
 * Enforced on the server, not just drawn on the client — an admin with a stale screen
 * must not be able to invite an organisation they have already declined, because the
 * timeline would then read as two contradictory decisions with no order between them.
 */
export function canTransition(from: PartnershipStatus, action: PartnershipAction): boolean {
  return PARTNERSHIP_STATUS_META[from].actions.includes(action)
}

/**
 * The screen's three groups, which are the three answers to "whose move is it".
 *
 * Not the same as the five statuses, deliberately. A tab per status would put one row
 * under "EOI sent" and one under "Invited" when both mean the identical thing to the
 * person reading — nothing to do, chase in a fortnight — while burying the two states
 * that ARE work under a status name that does not say so.
 */
export const PARTNERSHIP_TABS = [
  {
    id: 'to_action' as const,
    label: 'To action',
    waitingOn: 'us' as const,
    empty: 'Nothing waiting on you.',
  },
  {
    id: 'awaiting' as const,
    label: 'Awaiting them',
    waitingOn: 'them' as const,
    empty: 'Nothing out with an organisation.',
  },
  {
    id: 'closed' as const,
    label: 'Closed',
    waitingOn: 'closed' as const,
    empty: 'Nothing closed.',
  },
]

export type PartnershipTab = (typeof PARTNERSHIP_TABS)[number]['id']

export const PARTNERSHIP_TAB_IDS = PARTNERSHIP_TABS.map((t) => t.id)

/** The statuses a tab holds — how the server turns a tab into a `WHERE status IN (…)`. */
export function statusesForTab(tab: PartnershipTab): PartnershipStatus[] {
  const waitingOn = PARTNERSHIP_TABS.find((t) => t.id === tab)!.waitingOn
  return PARTNERSHIP_STATUSES.filter((s) => PARTNERSHIP_STATUS_META[s].waitingOn === waitingOn)
}

/**
 * Can this record be screened at all?
 *
 * `no_registration` is not a failure and not a thing to retry — the organisation has no
 * charity or company number, so there is nothing to screen against. The screen says so
 * and offers the only fix (adding a number), exactly as an application's does. See
 * `DueDiligenceStatus` for why that is its own status rather than a flavour of `review`.
 */
export function canScreen(charityNumber: string | null, companyNumber: string | null): boolean {
  return Boolean(charityNumber?.trim() || companyNumber?.trim())
}
