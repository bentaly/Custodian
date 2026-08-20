// ─── The weekly payments digest ──────────────────────────────────────────────
//
// Pure: the shape of the email and the rules for who gets one. The IO half —
// querying instalments, sending, writing receipts — is `src/server/financeDigest`.
// Split the same way as every other feature module here, and for the extra reason
// that this one is only ever seen in an inbox: a renderer that can be exercised in a
// test is the only way to look at Monday's email on a Tuesday.

/** One outstanding instalment, as the digest lists it. */
export interface DigestItem {
  awardId: string
  organisationName: string
  programmeName: string | null
  /** ISO yyyy-mm-dd. Never null — a dateless instalment cannot be "due this week". */
  dueDate: string
  amount: number
  instalmentNo: number
  /** True when the grant's bank details fail the stored modulus check. */
  bankFlagged: boolean
}

/** Everything the renderer needs. No database types cross this line. */
export interface DigestModel {
  clientName: string
  recipientName: string
  /** Monday of the week covered, ISO yyyy-mm-dd. */
  weekOf: string
  /** Unpaid, due before today. Older money is more urgent than this week's. */
  overdue: DigestItem[]
  /** Unpaid, due from today through the end of the digest window. */
  dueThisWeek: DigestItem[]
  /** Absolute URL of the Finance screen. */
  financeUrl: string
  /** Absolute URL that turns this email off without signing in. */
  unsubscribeUrl: string
}

export function digestTotal(items: DigestItem[]): number {
  return items.reduce((sum, i) => sum + i.amount, 0)
}

/**
 * Is there anything worth sending?
 *
 * A week with nothing due sends NOTHING — no "all clear" email. A recurring message
 * that is usually empty is one people filter to a folder, and once it is in a folder
 * the week it finally matters is the week it goes unread. The digest earns attention by
 * only arriving when there is something to act on.
 */
export function digestHasContent(model: DigestModel): boolean {
  return model.overdue.length > 0 || model.dueThisWeek.length > 0
}
