// ─── The new-awards email ────────────────────────────────────────────────────
//
// "These grants have been set up since we last told you." Sent on the DAYTIME cron
// (09:00/12:00/15:00/18:00 UTC) rather than weekly, because an award is a thing that
// happened rather than a thing that is due: a week's delay makes it history, and an
// instant one would mean an email per grant in a batch of twelve, arriving while the
// person setting them up was still in the wizard. A few hours is the shape that turns a
// board meeting's worth of awards into one message.
//
// Pure half here, IO in `src/server/awardNotifications`. Split like every other feature
// and for the reason the digests are: an email is only ever seen in an inbox, so a
// renderer you can exercise in a test is the only way to look at it on demand.
//
// Two bounds decide what is in it, and BOTH are load-bearing (see `pendingAwards`):
// nothing already announced to this person, and nothing older than the window. The
// first is what makes it idempotent; the second is what stops the first deploy mailing
// somebody their entire back catalogue.

/** One newly set-up grant, as the email lists it. */
export interface AwardNotificationItem {
  awardId: string
  organisationName: string
  programmeName: string | null
  /** The award's value, in pounds. */
  amount: number
  /** ISO yyyy-mm-dd, the date the grant period begins. Null when not set at set-up. */
  startDate: string | null
  /** ISO yyyy-mm-dd. When the award was created, which is what "new" is measured on. */
  createdDate: string
}

/** Everything the renderer needs. No database types cross this line. */
export interface AwardNotificationModel {
  clientName: string
  recipientName: string
  items: AwardNotificationItem[]
  /** Absolute URL of the Awards register. */
  awardsUrl: string
  /** Absolute URL that turns this email off without signing in. */
  unsubscribeUrl: string
}

export function awardNotificationTotal(items: AwardNotificationItem[]): number {
  return items.reduce((sum, i) => sum + i.amount, 0)
}

/**
 * Is there anything worth sending?
 *
 * Trivially "are there any", because unlike the digests this email is only ever
 * ASSEMBLED when there is something new — there is no standing list to be empty. It
 * exists so the run reads the same as the other two and so the empty case is stated
 * rather than assumed.
 */
export function awardNotificationHasContent(model: AwardNotificationModel): boolean {
  return model.items.length > 0
}
