import { fmtMoney } from './format'
import { resolveFirstYearAmount } from './multiYear'

/**
 * Proposing a different amount from the one an application asked for.
 *
 * An officer records what the foundation would actually award (`applications
 * .amount_amended`), usually at the shortlist and often after the board has discussed it.
 * It can be above or below the ask: foundations do fund more than was requested, and to
 * fund nothing is to decline. Everything counting shortlisted money then reads the
 * proposal (`effectiveAmount`); what the applicant asked for is never overwritten.
 *
 * ## Why the proposal and this year's share are set together
 *
 * They are one decision about one grant. The first-year share (`first_year_amount`) is a
 * part of the whole, so a whole that shrinks can leave a stated share larger than the
 * grant it belongs to, which `resolveFirstYearAmount` would then silently clamp. So one
 * dialog asks both, one write stores both, and a stated share the new amount no longer
 * holds is reset to the suggestion rather than clamped out of sight.
 *
 * ## Votes are never reset
 *
 * Trustees vote yes or no on whichever figure is on the card. A change leaves every vote
 * where it is; the card says how many were cast on a different figure (see
 * `application_votes.updated_at`), and the automatic comment puts the change in the
 * discussion they are reading anyway.
 *
 * `planAmendment` is the rule for the dialog and the server alike; the server fn
 * (`setAmendedAmount`) adds the budget ceiling, which needs the round's spend.
 */

export type AmendmentInput = {
  /** The application's ask. The proposal cannot exist without one. */
  requested: number
  /** What is stored now: NULL = the amount requested. */
  currentAmended: number | null
  /** The stated first-year share now: NULL = the suggestion. */
  currentFirstYear: number | null
  grantDurationYears: number | null
  /** The proposed amount, or `null` for "back to the amount requested". */
  amount: number | null
  /**
   * The first-year share, when the person also stated one. `undefined` = leave what is
   * stored (reset only if it no longer fits); `null` = the suggestion.
   */
  firstYearAmount?: number | null
}

export type AmendmentPlan = {
  /** The value to store in `amount_amended`: NULL when it equals the ask. */
  amended: number | null
  /** The value to store in `first_year_amount`. */
  firstYear: number | null
  /** The amount that would now be awarded. */
  effective: number
  /** Whether the AMOUNT changed (the first-year share alone is not a proposal). */
  amountChanged: boolean
  /** What the grant drew from the round's year before and after, for the ceiling. */
  drawdownBefore: number
  drawdownAfter: number
}

const PENNY = 0.005
const same = (a: number, b: number) => Math.abs(a - b) < PENNY

export function planAmendment(input: AmendmentInput): AmendmentPlan | { refused: string } {
  const { requested, grantDurationYears: years } = input
  if (input.amount !== null && !(Number.isFinite(input.amount) && input.amount > 0)) {
    return {
      refused: 'A proposed amount must be more than £0. To fund nothing, decline the application.',
    }
  }
  // Typing the ask back in is the same as taking the proposal away, and is stored as such:
  // "we agreed with what they asked" is not a figure somebody decided.
  const amended = input.amount === null || same(input.amount, requested) ? null : input.amount
  const effective = amended ?? requested
  const effectiveBefore = input.currentAmended ?? requested

  let firstYear: number | null
  if (input.firstYearAmount !== undefined) {
    if (input.firstYearAmount !== null && input.firstYearAmount > effective + PENNY) {
      return { refused: 'The amount in this year cannot be more than the whole grant.' }
    }
    if (input.firstYearAmount !== null && input.firstYearAmount < 0) {
      return { refused: 'The amount in this year cannot be negative.' }
    }
    firstYear = input.firstYearAmount
  } else {
    // A stated share that still fits is left alone, even when the amount goes up: it
    // is somebody's decision, and the dialog put it in front of them to revise.
    firstYear =
      input.currentFirstYear !== null && input.currentFirstYear > effective + PENNY
        ? null
        : input.currentFirstYear
  }
  // A share typed back to the suggestion is stored as NULL, as `FirstYearDialog` always did.
  if (firstYear !== null) {
    const suggested = resolveFirstYearAmount({
      amountRequested: effective,
      firstYearAmount: null,
      grantDurationYears: years,
    })
    if (same(firstYear, suggested)) firstYear = null
  }

  return {
    amended,
    firstYear,
    effective,
    amountChanged: !same(effective, effectiveBefore),
    drawdownBefore: resolveFirstYearAmount({
      amountRequested: effectiveBefore,
      firstYearAmount: input.currentFirstYear,
      grantDurationYears: years,
    }),
    drawdownAfter: resolveFirstYearAmount({
      amountRequested: effective,
      firstYearAmount: firstYear,
      grantDurationYears: years,
    }),
  }
}

/**
 * The comment a change posts in the application's discussion, as the admin who made it.
 * Plain words and no em dash: trustees read it in the thread beside their own comments.
 */
export function amendmentComment(
  from: number,
  to: number,
  requested: number,
  note?: string | null,
): string {
  const line = same(to, requested)
    ? `Proposed amount set back to the ${fmtMoney(requested)} requested.`
    : same(from, requested)
      ? `Proposed ${fmtMoney(to)} instead of the ${fmtMoney(requested)} requested.`
      : `Proposed amount changed from ${fmtMoney(from)} to ${fmtMoney(to)} (${fmtMoney(requested)} requested).`
  const reason = note?.trim()
  return reason ? `${line}\n\n${reason}` : line
}

/** "−£15,000 (−30%)" / "+£10,000 (+33%)": the change from the ask, for a pill or sub-line. */
export function amendmentDelta(effective: number, requested: number): string {
  const diff = effective - requested
  const sign = diff < 0 ? '−' : '+'
  const pct = requested > 0 ? Math.round((Math.abs(diff) / requested) * 100) : null
  return `${sign}${fmtMoney(Math.abs(diff))}${pct === null ? '' : ` (${sign}${pct}%)`}`
}

/** "−25%" / "+33%": the change from the ask as a percentage alone, to sit beside a figure. */
export function amendmentPercent(effective: number, requested: number): string {
  if (requested <= 0) return ''
  const diff = effective - requested
  return `${diff < 0 ? '−' : '+'}${Math.round((Math.abs(diff) / requested) * 100)}%`
}
