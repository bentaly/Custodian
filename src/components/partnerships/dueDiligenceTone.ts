import type { DueDiligenceStatus } from '../../lib/dueDiligence/types'
import { C } from '../ui/tokens'

// How a screening outcome reads on a partnership, in the one place both the list and
// the record read it from.
//
// The labels are shorter than the application screen's because they sit in a table
// column rather than on a panel with a paragraph under them — but they say the same
// things, and `no_registration` in particular keeps its own wording. It is not a
// failure and not a thing to retry: there is no number to screen against, so a person
// reading the row needs "Nothing to check" rather than a grey "Pending" that invites
// them to press a button which will do nothing (see `DueDiligenceStatus`).

export const DD_LABEL: Record<DueDiligenceStatus, string> = {
  pending: 'Not run',
  clear: 'Clear',
  warning: 'Warning',
  review: 'Review',
  blocked: 'Blocked',
  no_registration: 'Nothing to check',
}

export const DD_TONE_HEX: Record<DueDiligenceStatus, string> = {
  pending: C.sub,
  clear: C.success,
  warning: C.warning,
  review: C.warning,
  blocked: C.danger,
  // Grey, not amber. It is a statement about what CAN be checked, not a flag on the
  // organisation — the same reason it is its own status rather than a flavour of
  // `review`, and why it stays out of the dashboard's flag count.
  no_registration: C.faint,
}
