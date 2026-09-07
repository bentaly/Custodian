// ─── Who is in a decline batch, and who is not ──────────────────────────────────
//
// Pure, and shared by the dialog and the server function that sends. The rule has to be
// stated once: a dialog that offers to email twelve organisations and a server that
// then emails nine of them is worse than either behaviour on its own, because the count
// an admin approved is the one they will remember and repeat.
//
// The bar this clears is that **no address is ever sent a decline letter twice**.
// `decline_letters` is unique per application, which stops the same application being
// lettered twice; it does nothing about the same ADDRESS reached through a different
// application — the same charity applying to two programmes in one round, or applying
// again next year. The address is what a person reads, so the address is what is
// deduplicated.

/** One application that has been declined, as the batch sees it. */
export type DeclineCandidate = {
  applicationId: string
  organisationName: string
  applicantEmail: string | null
  /** This application's own letter, if it already has one. */
  letterStatus: 'draft' | 'sent' | 'failed' | null
}

/** A decline letter already written to an address, whatever produced it. */
export type AddressRecord = {
  email: string
  /** When it was sent; null while it is still queued. */
  at: string | null
  /** The round whose applicants it went out with. */
  roundName: string | null
}

export type DeclinePlan<T extends DeclineCandidate> = {
  /** Gets a letter. */
  toNotify: T[]
  /** Has a letter of its own already — including one that failed to send. */
  alreadyNotified: T[]
  /** Declined, but there is no address on the application to write to. */
  unreachable: T[]
  /** This address has had a decline letter before, through another application. */
  addressAlreadyWritten: Array<T & { previous: AddressRecord }>
  /** Two applications in this batch share one address; only the first is written to. */
  duplicateInBatch: T[]
}

/**
 * Addresses are compared case-insensitively and trimmed. Not a full normalisation —
 * nothing strips dots or `+tags`, because two addresses that differ that way genuinely
 * are two mailboxes at some providers, and silently withholding a decision from a
 * charity is a worse error than sending a second letter to somebody who set up an alias.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Split the declined applications in a round into what happens to each.
 *
 * Order matters: an application's own letter is checked before its address, so a
 * re-opened dialog explains a row as "already told" rather than as "that address has
 * had one" — both are true, and only the first is the reason.
 *
 * `previouslyWritten` should carry only letters that reached somebody or are still on
 * their way (`sent` or `draft`). A letter that FAILED did not tell anybody anything, so
 * it must not permanently bar the address: that would turn one bad afternoon at the mail
 * provider into a charity that never hears back.
 */
export function planDeclineBatch<T extends DeclineCandidate>({
  candidates,
  previouslyWritten,
}: {
  candidates: T[]
  previouslyWritten: AddressRecord[]
}): DeclinePlan<T> {
  const priorByEmail = new Map<string, AddressRecord>()
  for (const record of previouslyWritten) {
    const key = normaliseEmail(record.email)
    // Keep the most recent, so the dialog names the letter somebody actually remembers.
    const held = priorByEmail.get(key)
    if (!held || (record.at ?? '') > (held.at ?? '')) priorByEmail.set(key, record)
  }

  const plan: DeclinePlan<T> = {
    toNotify: [],
    alreadyNotified: [],
    unreachable: [],
    addressAlreadyWritten: [],
    duplicateInBatch: [],
  }
  const claimed = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.letterStatus) {
      plan.alreadyNotified.push(candidate)
      // Its address is spoken for from here on, so a SECOND application from the same
      // organisation in this round is a duplicate rather than a new letter.
      if (candidate.applicantEmail) claimed.add(normaliseEmail(candidate.applicantEmail))
      continue
    }
    if (!candidate.applicantEmail) {
      plan.unreachable.push(candidate)
      continue
    }

    const key = normaliseEmail(candidate.applicantEmail)
    const previous = priorByEmail.get(key)
    if (previous) {
      plan.addressAlreadyWritten.push({ ...candidate, previous })
      continue
    }
    if (claimed.has(key)) {
      plan.duplicateInBatch.push(candidate)
      continue
    }

    claimed.add(key)
    plan.toNotify.push(candidate)
  }

  return plan
}
