// ─── An expression of interest, in four states ───────────────────────────────
//
// `submitted` is the only one that is work: somebody has to read it and say yes or no.
// The others are decisions, and `applied` is where it stops: an application exists
// (`eois.application_id`), by invitation or straight to the shortlist. It never grows a
// `shortlisted` of its own, for the reason `partnership_status` does not.
//
// Named `Eoi*` throughout, and never to be confused with a PARTNERSHIP's `eoi_issued` /
// `eoi_received`: those say where a sourced relationship has got to, this is the
// submission itself.

export const EOI_STATUSES = ['submitted', 'invited_to_apply', 'declined', 'applied'] as const
export type EoiStatus = (typeof EOI_STATUSES)[number]

/**
 * `shortlist` makes an application (`progressEoi`) rather than changing a status
 * directly, but it is listed here so one table decides where the button is offered.
 */
export type EoiAction = 'invite' | 'shortlist' | 'decline' | 'reopen'

export const EOI_STATUS_META: Record<
  EoiStatus,
  { label: string; description: string; actions: readonly EoiAction[] }
> = {
  submitted: {
    label: 'To review',
    description: 'Waiting on you to read it and decide.',
    actions: ['invite', 'shortlist', 'decline'],
  },
  invited_to_apply: {
    label: 'Invited to apply',
    description: 'They have been invited to send a full application.',
    actions: ['shortlist', 'decline'],
  },
  declined: {
    // "Declined", not "Not taken forward" (feedback, 2026-10-06): it is the word the
    // letter that follows uses.
    label: 'Declined',
    description:
      'Declined. They are told when you send decline letters from the EOI list. Reopening puts it back to review.',
    actions: ['reopen'],
  },
  applied: {
    label: 'Applied',
    description: 'There is an application now, and it carries the story from here.',
    // None: the application has its own status, votes and decision.
    actions: [],
  },
}

export const EOI_ACTION_TO: Record<EoiAction, EoiStatus> = {
  invite: 'invited_to_apply',
  shortlist: 'applied',
  decline: 'declined',
  reopen: 'submitted',
}

/** Re-checked on the server against the status the row is actually in. */
export function canDecideEoi(from: EoiStatus, action: EoiAction): boolean {
  return EOI_STATUS_META[from].actions.includes(action)
}

/** The list's two tabs: what needs reading, and what has been decided. */
export const EOI_TABS = [
  { id: 'to_review' as const, label: 'To review', statuses: ['submitted'] as EoiStatus[] },
  {
    id: 'decided' as const,
    label: 'Decided',
    statuses: ['invited_to_apply', 'declined', 'applied'] as EoiStatus[],
  },
]
export type EoiTab = (typeof EOI_TABS)[number]['id']
