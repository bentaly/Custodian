import { useState } from 'react'
import { Input, Label, MoneyInput, Textarea } from '../ui'
import { C } from '../ui/tokens'
import { AreaInput } from '../applications/edit/AreaInput'
import { fmtAmount, fmtDate, fmtDuration, fmtMoney } from '../../lib/format'
import { impactUnitLabel } from '../../lib/impactUnits'
import { suggestFirstYearAmount } from '../../lib/multiYear'
import { roundFinancialYear } from '../../lib/roundYear'
import { DEFAULT_FY_END_MONTH } from '../../lib/financialYear'

// ─── What "Shortlist" asks, for a partnership or an EOI ──────────────────────────
//
// The one form both "Shortlist" dialogs share, in the order the Notion page sets out
// (2026-10-05): the amount and how it falls across the years, then purpose, area, impact,
// the organisation's finances and an address. Shortlisting without a form creates the
// application, so this is everything an application screen shows that nobody would
// otherwise have filled in.
//
// **No new fields.** "Across how many years" is the round-programme's grant duration,
// set on the round, and is stated rather than asked (a per-application duration does not
// exist). "Of which in 2026/27" is `applications.first_year_amount`, offered only where
// the duration is more than a year, prefilled with the suggestion (amount ÷ years) and
// stored as NULL while it stays the suggestion, as the amount dialog does. Income is the
// charity register's figure and is read-only; unrestricted reserves are published by no
// register, so they are typed or left blank.

export type ShortlistContext = {
  /** The round-programme it is being put into, for the years, the year and the unit. */
  roundProgramme: {
    grantDurationYears: number | null
    programme: { impactUnit: string; impactUnitLabel: string | null }
    round: {
      financialYearStart: string | null
      openedAt: Date | string | null
      closedAt: Date | string | null
    }
  } | null
  financialYearEndMonth: number | null
  /** The register's income where it has been read; null says why not, in `incomeNote`. */
  income: { amount: number; periodEnd: string | null } | null
  incomeNote: string
}

export type ShortlistInitial = {
  amount: string
  purpose: string
  deliveryArea: string
  proposedImpactQuantity: string
  contactEmail: string
}

export function useShortlistFields(initial: ShortlistInitial) {
  const [amount, setAmount] = useState(initial.amount)
  const [share, setShare] = useState<string | null>(null) // null = untouched, the suggestion
  const [purpose, setPurpose] = useState(initial.purpose)
  const [deliveryArea, setDeliveryArea] = useState(initial.deliveryArea)
  const [impact, setImpact] = useState(initial.proposedImpactQuantity)
  const [reserves, setReserves] = useState('')
  const [email, setEmail] = useState(initial.contactEmail)
  return {
    amount,
    setAmount,
    share,
    setShare,
    purpose,
    setPurpose,
    deliveryArea,
    setDeliveryArea,
    impact,
    setImpact,
    reserves,
    setReserves,
    email,
    setEmail,
  }
}
export type ShortlistForm = ReturnType<typeof useShortlistFields>

const isNumber = (v: string) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0

/**
 * The values to send, and whether they can be sent. `null` firstYearAmount is the
 * suggestion, so a share typed back to the suggested figure stores nothing.
 */
export function shortlistPayload(form: ShortlistForm, years: number | null) {
  const amount = Number(form.amount)
  const amountValid = form.amount.trim() !== '' && Number.isFinite(amount) && amount > 0
  const suggested = amountValid ? suggestFirstYearAmount(amount, years) : 0
  const share = form.share === null ? null : Number(form.share)
  const shareValid = form.share === null || (isNumber(form.share) && share! <= amount + 0.005)
  const impactValid = form.impact.trim() === '' || isNumber(form.impact)
  const reservesValid = form.reserves.trim() === '' || isNumber(form.reserves)
  const emailValid = form.email.trim() === '' || /^\S+@\S+\.\S+$/.test(form.email.trim())
  return {
    valid:
      amountValid &&
      shareValid &&
      impactValid &&
      reservesValid &&
      emailValid &&
      form.purpose.trim() !== '',
    data: {
      amount,
      firstYearAmount:
        share === null || !years || years <= 1 || Math.abs(share - suggested) < 0.005
          ? null
          : share,
      purpose: form.purpose.trim(),
      deliveryArea: form.deliveryArea.trim() || null,
      proposedImpactQuantity: form.impact.trim() || null,
      unrestrictedReserves: form.reserves.trim() ? Number(form.reserves) : null,
      contactEmail: form.email.trim() || null,
    },
  }
}

export function ShortlistFields({
  form,
  context,
  idPrefix,
}: {
  form: ShortlistForm
  context: ShortlistContext
  idPrefix: string
}) {
  const rp = context.roundProgramme
  const years = rp?.grantDurationYears ?? null
  const fy = rp
    ? roundFinancialYear(rp.round, context.financialYearEndMonth ?? DEFAULT_FY_END_MONTH)
    : null
  const amount = Number(form.amount)
  const amountValid = form.amount.trim() !== '' && Number.isFinite(amount) && amount > 0
  const suggested = amountValid ? suggestFirstYearAmount(amount, years) : 0
  const multiYear = years !== null && years > 1
  const unit = rp
    ? impactUnitLabel(rp.programme.impactUnit, rp.programme.impactUnitLabel).toLowerCase()
    : 'people'
  const id = (name: string) => `${idPrefix}-${name}`
  const hint = 'mt-1.5 font-display text-label'

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor={id('amount')}>Amount to award</Label>
          <MoneyInput
            id={id('amount')}
            label="Amount to award"
            value={form.amount}
            onChange={form.setAmount}
          />
        </div>
        <div>
          {/* Stated, not asked: the duration is the round-programme's, set on the round. */}
          <p className="mb-1.5 font-display text-body font-medium text-grey-700">
            Across how many years
          </p>
          <p className="flex h-10 items-center font-display text-body" style={{ color: C.ink }}>
            {fmtDuration(years) ?? 'Not set'}
          </p>
          <p className={hint} style={{ color: C.sub }}>
            Set on the round.
          </p>
        </div>
        {multiYear && fy && (
          <div>
            <Label htmlFor={id('share')}>Of which in {fy.label}</Label>
            <MoneyInput
              id={id('share')}
              label={`Amount falling in ${fy.label}`}
              value={form.share ?? String(suggested || '')}
              onChange={form.setShare}
            />
            <p className={hint} style={{ color: C.sub }}>
              Suggested {fmtMoney(suggested)} (amount ÷ years).
              {form.share !== null && Math.abs(Number(form.share) - suggested) >= 0.005 && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="underline"
                    style={{ color: C.brand }}
                    onClick={() => form.setShare(null)}
                  >
                    Use this
                  </button>
                </>
              )}
            </p>
            {form.share !== null && amountValid && Number(form.share) > amount + 0.005 && (
              <p className={hint} style={{ color: C.danger }}>
                That is more than the whole grant.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor={id('purpose')}>Grant purpose</Label>
        <Textarea
          id={id('purpose')}
          rows={3}
          value={form.purpose}
          onChange={(e) => form.setPurpose(e.target.value)}
          placeholder="What the grant would pay for, in a sentence or two"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={id('area')}>Grant delivery area</Label>
          <AreaInput id={id('area')} value={form.deliveryArea} onChange={form.setDeliveryArea} />
        </div>
        <div>
          <Label htmlFor={id('impact')}>Proposed impact (quantity)</Label>
          <Input
            id={id('impact')}
            inputMode="numeric"
            value={form.impact}
            onChange={(e) => form.setImpact(e.target.value)}
            placeholder="0"
          />
          <p className={hint} style={{ color: C.sub }}>
            {unit}, over the whole grant
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          {/* The register's figure, never typed: it is what the scale of the ask is read
              against, and a typed one would be a second, unsourced income. */}
          <p className="mb-1.5 font-display text-body font-medium text-grey-700">Income</p>
          <p className="flex h-10 items-center font-display text-body" style={{ color: C.ink }}>
            {context.income ? fmtAmount(context.income.amount) : '--'}
          </p>
          <p className={hint} style={{ color: C.sub }}>
            {context.income
              ? `From the charity register${context.income.periodEnd ? `, year to ${fmtDate(context.income.periodEnd)}` : ''}.`
              : context.incomeNote}
          </p>
        </div>
        <div>
          <Label htmlFor={id('reserves')}>Unrestricted reserves</Label>
          <MoneyInput
            id={id('reserves')}
            label="Unrestricted reserves"
            value={form.reserves}
            onChange={form.setReserves}
          />
          <p className={hint} style={{ color: C.sub }}>
            No register publishes this. Leave it blank if you do not know.
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor={id('email')}>Contact email</Label>
        <Input
          id={id('email')}
          type="email"
          value={form.email}
          onChange={(e) => form.setEmail(e.target.value)}
          placeholder="name@organisation.org.uk"
        />
        <p className={hint} style={{ color: C.sub }}>
          Where the award letter goes.
        </p>
      </div>
    </div>
  )
}
