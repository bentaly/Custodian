// ─── Audit vocabulary ────────────────────────────────────────────────────────
//
// Pure half of the audit log: the set of things that can be recorded, and which of
// them the dashboard shows. The IO lives in `src/server/audit.ts`.
//
// It is here rather than beside the writer because BOTH sides need it — the server
// writes rows, and the dashboard route decides what to render — and a route must not
// import a module that pulls `getDb` into the browser bundle.

/**
 * Every human action the platform records.
 *
 * Deliberately narrow in one direction and broad in another. It records *people doing
 * things*: it does NOT record external submissions (a charity applying or reporting) or
 * system/AI events (scoring, due diligence), which are derivable from their own
 * timestamped rows and aren't "someone did something" moments.
 *
 * Within that, it records everything — including the actions nobody wants on a
 * dashboard. See `FEED_ACTIONS`.
 */
export type AuditAction =
  // ── Decisions on an application ──────────────────────────────────────────
  | 'application_awarded'
  | 'application_declined'
  | 'application_shortlisted'
  | 'application_commented'
  // A comment was removed. The log NEVER loses the fact that something was said and
  // then unsaid — deleting the audit row alongside the comment would make the trail
  // agree with whoever most recently changed their mind, which is the one thing an
  // audit trail exists not to do.
  | 'application_comment_deleted'
  // An admin supplied a charity/company number that was never captured, so the
  // grantee could finally be screened. A statement about who is being funded, not a
  // typo fix, which is why it is in the feed rather than only in the column.
  | 'application_registration_set'
  // An admin recorded a vote on a trustee's behalf (only possible where the client has
  // turned admin voting on). The vote itself is stored against the TRUSTEE — that is
  // whose vote it is — so without this row and `application_votes.recorded_by_user_id`
  // there is nothing anywhere distinguishing a vote a trustee cast from one an
  // administrator entered for them. A trustee voting as themselves is not recorded
  // here: the vote row already carries them, and it isn't an unusual event.
  | 'application_vote_recorded_by_admin'

  // ── Money ────────────────────────────────────────────────────────────────
  // The account a grant is paid into was changed by hand on the payment panel. The one
  // edit in the app that moves money somewhere else, so it is a fact about the grant
  // rather than a correction to a field.
  | 'grant_bank_details_changed'
  // An instalment was ticked off as paid, or that tick was taken back. The names say
  // "recorded"/"reversed" rather than "paid"/"unpaid" because that is what actually
  // happened here: the money moves in the foundation's banking, and what Custodian
  // holds is somebody's statement that it did. The instalment row keeps the date the
  // money went; only these say WHO said so and when they said it.
  //
  // The reversal is not an afterthought — a payment marked paid and then unmarked is
  // exactly the shape an auditor looks for, and recording only the tick would leave the
  // trail claiming money went out that the schedule says is still outstanding.
  | 'grant_payment_recorded'
  | 'grant_payment_reversed'
  // A scheduled instalment's amount or due date was changed. Moving £50,000 two
  // quarters down the schedule is the same class of act as ticking one off, and was
  // the obvious gap left by recording only the tick.
  | 'grant_payment_amended'
  // The foundation's annual grant-making budget for a financial year was set or
  // changed. Recorded because it is the figure every "remaining to allocate" number on
  // the Finance screen is measured against — moving it moves what the organisation
  // believes it can still give away, and "who raised the budget?" must have an answer.
  | 'annual_budget_set'
  // A reading of the grant-making bank balance was entered. The balance is typed by
  // hand off a statement, so the row IS the provenance: without it the figure a board
  // acted on has no author and no date it was true.
  | 'bank_balance_recorded'

  // ── Reporting obligations ────────────────────────────────────────────────
  // What a grantee owes, and when. Changing or removing a milestone changes the
  // obligation itself, which is why the three are distinct: "who dropped the
  // requirement for a final report?" is a question the log should answer directly.
  | 'grant_report_milestone_added'
  | 'grant_report_milestone_changed'
  | 'grant_report_milestone_removed'
  // An admin signed off (or un-signed) a received report as reviewed.
  | 'grant_report_reviewed'
  // The award letter was sent to the grantee again — an outbound communication to a
  // third party, possibly to a different address than the original.
  | 'award_letter_resent'

  // ── Access and configuration (no application) ────────────────────────────
  // A key that lets anything on the internet submit applications AS the foundation,
  // and the revocation that stops it.
  | 'api_key_created'
  | 'api_key_revoked'
  // Somebody was granted access to the tenant at a role. Roles are set at invitation
  // and never edited afterwards, so this IS the access-control event.
  | 'invitation_sent'

/**
 * The subset the dashboard's "Lately" panel shows.
 *
 * The log records everything; the feed is a reading of it, not a mirror. The line is
 * whether the whole team would want to know: decisions on applications, and money or
 * reporting moving on a grant. Housekeeping (rescheduling an instalment, editing a
 * milestone), corrections (a deleted comment) and configuration (keys, invitations)
 * are recorded and stay out of the panel — a dashboard that lists every milestone edit
 * teaches people to stop reading it, and a feed nobody reads is worse than none.
 *
 * The filter is applied in SQL, not after the fetch: "Lately" takes the most recent
 * rows, so filtering afterwards would let a run of key rotations return eight rows that
 * all render as nothing and leave the panel looking empty.
 */
export const FEED_ACTIONS = [
  'application_awarded',
  'application_declined',
  'application_shortlisted',
  'application_commented',
  'application_registration_set',
  'application_vote_recorded_by_admin',
  'grant_bank_details_changed',
  'grant_payment_recorded',
  'grant_payment_reversed',
  'grant_report_reviewed',
] as const satisfies readonly AuditAction[]

/** An action the "Lately" panel knows how to render. */
export type FeedAction = (typeof FEED_ACTIONS)[number]

// ─── Reading an entry ────────────────────────────────────────────────────────
//
// Everything below turns a stored row back into words. It is here, not in the screens,
// because three readers need the same answer — the dashboard's "Lately" panel, the
// Activity table, and the CSV that leaves the building — and an action described two
// ways in two places is the drift this module exists to prevent.

/**
 * The four kinds of thing that happen, used to group the Activity screen's filter.
 *
 * Grouped by what a person is looking FOR, not by which table was written: somebody
 * arrives asking "what happened to the money" or "who was let in", and neither question
 * follows the schema. Every action has exactly one category, enforced by the `Record`.
 */
export type AuditCategory = 'decisions' | 'money' | 'reporting' | 'access'

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  decisions: 'Decisions',
  money: 'Money',
  reporting: 'Reporting',
  access: 'Access',
}

export const ACTION_CATEGORY: Record<AuditAction, AuditCategory> = {
  application_awarded: 'decisions',
  application_declined: 'decisions',
  application_shortlisted: 'decisions',
  application_commented: 'decisions',
  application_comment_deleted: 'decisions',
  application_registration_set: 'decisions',
  application_vote_recorded_by_admin: 'decisions',
  grant_bank_details_changed: 'money',
  grant_payment_recorded: 'money',
  grant_payment_reversed: 'money',
  grant_payment_amended: 'money',
  annual_budget_set: 'money',
  bank_balance_recorded: 'money',
  grant_report_milestone_added: 'reporting',
  grant_report_milestone_changed: 'reporting',
  grant_report_milestone_removed: 'reporting',
  grant_report_reviewed: 'reporting',
  award_letter_resent: 'reporting',
  api_key_created: 'access',
  api_key_revoked: 'access',
  invitation_sent: 'access',
}

/** Every action in a category — the Activity filter turns one into a SQL `IN` list. */
export function actionsInCategory(category: AuditCategory): AuditAction[] {
  return (Object.keys(ACTION_CATEGORY) as AuditAction[]).filter(
    (a) => ACTION_CATEGORY[a] === category,
  )
}

/**
 * The verb phrase, written to sit between the actor and the subject:
 * "{Alexandra} {recorded a payment to} {Hope Trust}".
 *
 * Past tense throughout — this is a record of what happened, never an instruction —
 * and named as what it is. A proxy vote must not soften to "voted on": telling it
 * apart from a trustee's own vote is the entire reason the row exists.
 */
export const ACTION_VERB: Record<AuditAction, string> = {
  application_awarded: 'awarded a grant to',
  application_declined: 'declined',
  application_shortlisted: 'shortlisted',
  application_commented: 'commented on',
  application_comment_deleted: 'deleted a comment on',
  application_registration_set: 'added a registration number and screened',
  application_vote_recorded_by_admin: "recorded a trustee's vote on",
  grant_bank_details_changed: 'changed the payment account for',
  grant_payment_recorded: 'recorded a payment to',
  grant_payment_reversed: 'reversed a recorded payment to',
  grant_payment_amended: 'changed a scheduled payment for',
  annual_budget_set: 'set the annual budget',
  bank_balance_recorded: 'recorded the bank balance',
  grant_report_milestone_added: 'added a reporting milestone for',
  grant_report_milestone_changed: 'changed a reporting milestone for',
  grant_report_milestone_removed: 'removed a reporting milestone for',
  grant_report_reviewed: 'reviewed a report from',
  award_letter_resent: 'resent the award letter to',
  api_key_created: 'created an API key',
  api_key_revoked: 'revoked an API key',
  invitation_sent: 'invited',
}

/** Short noun label — the CSV's Action column, where a verb phrase would read oddly. */
export const ACTION_LABEL: Record<AuditAction, string> = {
  application_awarded: 'Grant awarded',
  application_declined: 'Application declined',
  application_shortlisted: 'Application shortlisted',
  application_commented: 'Comment added',
  application_comment_deleted: 'Comment deleted',
  application_registration_set: 'Registration number set',
  application_vote_recorded_by_admin: 'Vote recorded by admin',
  grant_bank_details_changed: 'Payment account changed',
  grant_payment_recorded: 'Payment recorded',
  grant_payment_reversed: 'Payment reversed',
  grant_payment_amended: 'Payment schedule changed',
  annual_budget_set: 'Annual budget set',
  bank_balance_recorded: 'Bank balance recorded',
  grant_report_milestone_added: 'Reporting milestone added',
  grant_report_milestone_changed: 'Reporting milestone changed',
  grant_report_milestone_removed: 'Reporting milestone removed',
  grant_report_reviewed: 'Report reviewed',
  award_letter_resent: 'Award letter resent',
  api_key_created: 'API key created',
  api_key_revoked: 'API key revoked',
  invitation_sent: 'Invitation sent',
}

type Meta = Record<string, unknown> | null | undefined

function str(m: Meta, key: string): string | null {
  const v = m?.[key]
  return typeof v === 'string' && v.length > 0 ? v : typeof v === 'number' ? String(v) : null
}

function nested(m: Meta, key: string): Record<string, unknown> | null {
  const v = m?.[key]
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** "a → b", or just what there is when one side is missing. Blank when neither is. */
function change(from: string | null, to: string | null): string | null {
  if (from && to) return from === to ? from : `${from} → ${to}`
  return to ?? from
}

/**
 * What an entry was ABOUT, for rows that concern no application: the invitee, the key.
 * Application-scoped rows take the organisation's name instead, which the query joins.
 */
export function auditSubject(action: AuditAction, metadata: Meta): string | null {
  switch (action) {
    case 'invitation_sent':
      return str(metadata, 'email')
    case 'api_key_created':
    case 'api_key_revoked': {
      const name = str(metadata, 'name')
      const last4 = str(metadata, 'last4')
      return name && last4 ? `${name} (••••${last4})` : (name ?? (last4 ? `••••${last4}` : null))
    }
    default:
      return null
  }
}

/**
 * The stored extras, in words — the column that makes the difference between a log you
 * can read and one you have to interpret.
 *
 * Both sides are given wherever the row recorded them, because the thing being audited
 * is usually the CHANGE: "£10,000 → £12,000" answers the question that "£12,000" only
 * raises. Returns an empty string rather than a placeholder when an entry genuinely has
 * nothing to add, so the column stays quiet instead of printing "—" nineteen times.
 */
export function auditDetail(action: AuditAction, metadata: Meta): string {
  const parts: (string | null)[] = []

  switch (action) {
    case 'application_awarded':
      parts.push(str(metadata, 'amountAwarded') ? `£${str(metadata, 'amountAwarded')}` : null)
      break

    case 'application_registration_set':
      parts.push(
        str(metadata, 'charityNumber') ? `Charity ${str(metadata, 'charityNumber')}` : null,
        str(metadata, 'companyNumber') ? `Company ${str(metadata, 'companyNumber')}` : null,
        str(metadata, 'dueDiligenceStatus'),
      )
      break

    case 'application_vote_recorded_by_admin': {
      const vote = str(metadata, 'vote')
      const on = str(metadata, 'onBehalfOf')
      parts.push(
        vote === 'yes' ? 'Approved' : vote === 'no' ? 'Declined' : null,
        on ? `on behalf of ${on}` : null,
      )
      break
    }

    case 'application_comment_deleted': {
      const body = str(metadata, 'body')
      parts.push(body ? `“${body.length > 120 ? `${body.slice(0, 119)}…` : body}”` : null)
      break
    }

    case 'grant_bank_details_changed': {
      const from = nested(metadata, 'from')
      const to = nested(metadata, 'to')
      const acct = (m: Record<string, unknown> | null) => {
        const sort = str(m, 'sortCode')
        const last4 = str(m, 'last4')
        return [sort, last4 ? `••••${last4}` : null].filter(Boolean).join(' ') || null
      }
      parts.push(change(acct(from), acct(to)))
      break
    }

    case 'grant_payment_recorded':
    case 'grant_payment_reversed': {
      const no = str(metadata, 'instalmentNo')
      const amount = str(metadata, 'amount')
      const date = str(metadata, 'paidDate')
      parts.push(
        no ? `Instalment ${no}` : null,
        amount ? `£${amount}` : null,
        date ? (action === 'grant_payment_recorded' ? `paid ${date}` : `was ${date}`) : null,
      )
      break
    }

    case 'annual_budget_set': {
      const year = str(metadata, 'financialYear')
      const total = nested(metadata, 'total')
      parts.push(
        year,
        total
          ? change(
              str(total, 'from') !== null ? `£${str(total, 'from')}` : null,
              str(total, 'to') !== null ? `£${str(total, 'to')}` : null,
            )
          : null,
      )
      break
    }

    case 'bank_balance_recorded': {
      const amount = str(metadata, 'amount')
      const asAt = str(metadata, 'asAtDate')
      parts.push(amount ? `£${amount}` : null, asAt ? `as at ${asAt}` : null)
      break
    }

    case 'grant_payment_amended': {
      const no = str(metadata, 'instalmentNo')
      const amount = nested(metadata, 'amount')
      const due = nested(metadata, 'dueDate')
      const money = amount
        ? change(
            str(amount, 'from') ? `£${str(amount, 'from')}` : null,
            str(amount, 'to') ? `£${str(amount, 'to')}` : null,
          )
        : null
      // A date cleared back to "TBC" is a real edit, so an absent `to` is spelled out
      // rather than dropped — the change() default would have hidden it.
      const dates = due ? (change(str(due, 'from'), str(due, 'to') ?? 'no date') ?? null) : null
      parts.push(no ? `Instalment ${no}` : null, money, dates ? `due ${dates}` : null)
      break
    }

    case 'grant_report_milestone_added':
    case 'grant_report_milestone_removed': {
      const label = str(metadata, 'label')
      const due = str(metadata, 'dueDate')
      parts.push(
        label,
        due ? (action === 'grant_report_milestone_added' ? `due ${due}` : `was due ${due}`) : null,
      )
      break
    }

    case 'grant_report_milestone_changed': {
      const from = nested(metadata, 'from')
      const to = nested(metadata, 'to')
      parts.push(
        change(str(from, 'label'), str(to, 'label')),
        change(str(from, 'dueDate'), str(to, 'dueDate'))
          ? `due ${change(str(from, 'dueDate'), str(to, 'dueDate'))}`
          : null,
      )
      break
    }

    case 'grant_report_reviewed':
      parts.push(metadata?.['reviewed'] === false ? 'Review cleared' : 'Marked reviewed')
      break

    case 'award_letter_resent':
      parts.push(str(metadata, 'recipientEmail'))
      break

    case 'invitation_sent':
      parts.push(str(metadata, 'role'))
      break

    default:
      break
  }

  return parts.filter(Boolean).join(' · ')
}
