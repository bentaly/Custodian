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
  'applied',
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

/**
 * `shortlist` is the odd one out: it is not a status change `actOnPartnership` can make,
 * because it has to create an application in a round somebody picks. It is listed here
 * so the same table decides where the button is offered, and `progressPartnership`
 * re-checks it with `canTransition` like any other move.
 */
export type PartnershipAction = 'issue_eoi' | 'invite' | 'shortlist' | 'decline' | 'reopen'

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
    actions: ['issue_eoi', 'invite', 'shortlist', 'decline'],
  },
  eoi_issued: {
    label: 'EOI sent',
    description: 'They have been asked for an expression of interest. Waiting on them to answer.',
    waitingOn: 'them',
    tone: 'info',
    // No `issue_eoi`: it has been issued. Re-sending is a chase, which belongs on the
    // contact rather than in the pipeline's list of moves.
    actions: ['invite', 'shortlist', 'decline'],
  },
  eoi_received: {
    label: 'EOI received',
    description: 'They have answered. Waiting on you to read it and decide.',
    waitingOn: 'us',
    tone: 'warning',
    actions: ['invite', 'shortlist', 'decline'],
  },
  invited: {
    label: 'Invited to apply',
    description: 'They have been invited to apply. Waiting on their application.',
    waitingOn: 'them',
    // Still offered here: an organisation invited to fill in a form that staff then
    // decide to vouch for directly is an ordinary change of mind.
    actions: ['shortlist', 'decline'],
    tone: 'success',
  },
  declined: {
    // "Not pursuing" until 2026-10-06; "Closed" reads as the end of a conversation
    // without saying anything about the organisation. Reopening is the way back.
    label: 'Closed',
    description: 'Closed. Reopening puts them back at the top of the pipeline.',
    waitingOn: 'closed',
    tone: 'danger',
    actions: ['reopen'],
  },
  applied: {
    label: 'Applied',
    description:
      'There is an application now, and it carries the story from here. Nothing further happens on this record.',
    waitingOn: 'closed',
    tone: 'success',
    // None, on purpose. The application has its own status, votes and decision; a move
    // here would be a second answer to a question that screen already owns.
    actions: [],
  },
}

/**
 * The verb on the button, and the sentence written into the timeline when it is
 * pressed. Both live here so the history cannot describe an action differently from the
 * button that caused it.
 *
 * **The two correspondence actions can happen two ways, and the history tells them
 * apart.** Custodian can email the link itself (`sendPartnershipEmail`): the status moves
 * only after Resend has accepted the message, and the line reads "Custodian emailed …",
 * a receipt. Or the admin sends it from their own inbox and says so ("I've sent it
 * myself", `actOnPartnership`): that line reads "Marked … as sent", their statement.
 *
 * These buttons once opened a `mailto:` and moved the status in one gesture, which meant
 * closing the draft without sending still left the record asserting that a form "has
 * gone out". A `mailto:` is handed to the operating system and never reports back. So a
 * status never moves on the strength of a draft: either we sent it and know, or a person
 * states that they did.
 */
export const PARTNERSHIP_ACTION_META: Record<
  PartnershipAction,
  { label: string; /** Resulting status. */ to: PartnershipStatus; destructive?: boolean }
> = {
  issue_eoi: { label: 'Request EOI', to: 'eoi_issued' },
  invite: { label: 'Invite to apply', to: 'invited' },
  shortlist: { label: 'Shortlist', to: 'applied' },
  decline: { label: 'Close', to: 'declined', destructive: true },
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
/**
 * What the AI assessment still needs before it can run, in the words the screen prints.
 * Empty means it can. The three are what the prompt is built from: the programme is the
 * yardstick, and a value and a purpose are the whole of the "ask" a sourced partner has.
 */
export function assessmentGaps(p: {
  programmeId: string | null
  amountSought: string | number | null
  proposedPurpose: string | null
}): string[] {
  return [
    p.programmeId ? null : 'a programme',
    p.amountSought != null && Number(p.amountSought) > 0 ? null : 'a proposed grant value',
    p.proposedPurpose?.trim() ? null : 'a proposed purpose',
  ].filter((g): g is string => g !== null)
}

export function canScreen(charityNumber: string | null, companyNumber: string | null): boolean {
  return Boolean(charityNumber?.trim() || companyNumber?.trim())
}
