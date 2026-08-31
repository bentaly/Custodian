import { useMemo, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import {
  getAnnualBudgetSettings,
  saveAnnualBudget,
  saveFinancialYearEndMonth,
  setBalanceAndBudgetVisible,
} from '../../server/fns/budget'
import {
  Button,
  ErrorNote,
  Input,
  Label,
  MoneyInput,
  Panel,
  PanelTitle,
  Select,
  TOKENS as C,
  Toggle,
} from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'
import { canSeePayments } from '../../lib/roles'
import { MONTH_NAMES, financialYearRange } from '../../lib/financialYear'
import { rollUpBudget } from '../../lib/annualBudget'
import { fmtMoney } from '../../lib/format'
import { messageFor } from '../../lib/errors'
import { resolveProgrammeColour } from '../../lib/programmeColours'

/**
 * Settings → Annual budget.
 *
 * The **plan** half of the bank-balance-and-budget feature. It lives in Settings, next
 * to Rounds and Programmes, because a budget is a decision the trustees take once a year
 * — configuration, not daily work. Its counterpart, the bank balance, is recorded on
 * Finance instead, where somebody is already looking at the number.
 *
 * ## The reconciliation is the feature
 *
 * The annual figures are STATED, not derived from `round_programmes.budget`, because a
 * foundation can budget £366,000 to a programme for the year and put only £300,000 of it
 * into rounds, holding the rest back for unsolicited grants. Deriving would make that
 * unrepresentable — and it would also delete the one check that cannot exist today:
 * *your rounds have allocated £X of the £Y you budgeted*. Two numbers that are allowed to
 * differ are what makes the difference meaningful.
 *
 * The cost of stating it is double entry for the foundation whose rounds ARE their year's
 * plan, and that is paid off in the UI rather than the schema: **Use round allocations**
 * fills the form from the rounds and they are done in one click.
 *
 * ## Nothing here is required
 *
 * A foundation that never opens this screen simply has no budget, and the Finance panel
 * shows their cash position alone (or nothing, if they record no balance either). There
 * is no enable/disable switch, because absence already is one.
 */
export const Route = createFileRoute('/_authenticated/settings/budget')({
  // Admin and finance, matching Finance itself — a budget sits beside the cash position,
  // and `canSeePayments` is the line the app already draws around money. The server fns
  // re-check; this only stops a trustee being shown a door that redirects them away.
  beforeLoad: ({ context }) => {
    if (!canSeePayments(context.user.role)) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ data: await getAnnualBudgetSettings({ data: {} }) }),
  component: AnnualBudget,
})

type Row = {
  key: string
  programmeId: string | null
  label: string
  colour: string | null
  amount: string
}

let coreKey = 0
const newCoreRow = (label = 'Core costs'): Row => ({
  key: `core-${coreKey++}`,
  programmeId: null,
  label,
  colour: null,
  amount: '',
})

function AnnualBudget() {
  const { data } = Route.useLoaderData()
  const router = useRouter()

  // Every active programme gets a row whether or not it is in the saved budget: the
  // screen is "what is this year's money", and a programme missing from the form reads
  // as a programme that no longer exists rather than one funded nothing.
  const initialRows = useMemo<Row[]>(() => {
    const saved = new Map(
      data.lines.filter((l) => l.programmeId).map((l) => [l.programmeId!, l.amount]),
    )
    const programmeRows: Row[] = data.programmes.map((p) => ({
      key: p.id,
      programmeId: p.id,
      label: p.name,
      colour: p.colour,
      amount: saved.has(p.id) ? String(saved.get(p.id)) : '',
    }))
    const coreRows: Row[] = data.lines
      .filter((l) => !l.programmeId)
      .map((l) => ({ ...newCoreRow(l.label ?? 'Core costs'), amount: String(l.amount) }))
    return [...programmeRows, ...(coreRows.length > 0 ? coreRows : [newCoreRow()])]
  }, [data])

  const [rows, setRows] = useState<Row[]>(initialRows)
  const [endMonth, setEndMonth] = useState(data.financialYearEndMonth)
  const [visible, setVisible] = useState(data.showBalanceAndBudget)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const allocatedByProgramme = useMemo(
    () => new Map(data.roundAllocations.map((a) => [a.programmeId, a.allocated])),
    [data.roundAllocations],
  )

  const amount = (r: Row) => {
    const n = parseFloat(r.amount)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  /**
   * What a row set would actually SAVE, as a comparable string.
   *
   * Compared against the loaded budget so Save stays disabled until something has really
   * changed. Built from the PAYLOAD rather than the rows, because the two are not the
   * same thing: a blank amount and a `0` both mean "no line", and a core-cost row carries
   * a generated `key` that differs between the loaded set and the edited one. Row order
   * is significant — lines are stored and drawn in it — so this compares in order rather
   * than sorting.
   */
  const payloadOf = (rs: Row[]) =>
    JSON.stringify(
      rs
        .filter((r) => amount(r) > 0)
        .map((r) => [
          r.programmeId,
          r.programmeId ? null : r.label.trim() || 'Core costs',
          amount(r),
        ]),
    )
  // After a save, `router.invalidate()` reloads the budget and `initialRows` recomputes to
  // match what was just written, so this settles back to false on its own.
  const dirty = payloadOf(rows) !== payloadOf(initialRows)
  // Clearing every amount is how a budget is removed — there is no separate destructive
  // action, because "no lines" and "no budget" are the same statement and a second way to
  // say it would only be a second thing to keep in step. The button says so rather than
  // leaving it to be discovered.
  const removing = data.exists && payloadOf(rows) === '[]'

  const total = rows.reduce((s, r) => s + amount(r), 0)
  const coreCosts = rows.filter((r) => !r.programmeId).reduce((s, r) => s + amount(r), 0)
  const grantMaking = total - coreCosts
  const allocatedInRounds = data.roundAllocations.reduce((s, a) => s + a.allocated, 0)

  const patch = (key: string, next: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)))

  // Fills only the programme rows. Core-cost lines are not in any round by definition,
  // so a foundation that has entered them keeps them.
  function useRoundAllocations() {
    setRows((rs) =>
      rs.map((r) =>
        r.programmeId && allocatedByProgramme.has(r.programmeId)
          ? { ...r, amount: String(allocatedByProgramme.get(r.programmeId)) }
          : r,
      ),
    )
    setSaved(false)
  }

  /**
   * Show or hide the whole feature.
   *
   * Hiding writes ONE boolean and touches no figures. The first cut had no switch at all,
   * on the reasoning that "absence is the setting" — which only holds while getting from
   * on to off is free, and here it meant deleting a budget somebody had spent an afternoon
   * entering. A visibility preference cannot contradict the data, because it makes no
   * claim about it.
   */
  async function handleVisibility(next: boolean) {
    setVisible(next)
    setError('')
    try {
      await setBalanceAndBudgetVisible({ data: { visible: next } })
      await router.invalidate()
    } catch (e) {
      setError(messageFor(e))
      setVisible(!next)
    }
  }

  async function handleSaveYearEnd(month: number) {
    setEndMonth(month)
    setError('')
    try {
      await saveFinancialYearEndMonth({ data: { month } })
      // The whole page is derived from the year, so it reloads rather than trying to
      // re-derive dates in the browser and drifting from what the server would say.
      await router.invalidate()
    } catch (e) {
      setError(messageFor(e))
      setEndMonth(data.financialYearEndMonth)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await saveAnnualBudget({
        data: {
          financialYearStart: data.financialYear.start,
          financialYearEnd: data.financialYear.end,
          label: data.financialYear.label,
          lines: rows
            .filter((r) => amount(r) > 0)
            .map((r) => ({
              programmeId: r.programmeId,
              label: r.programmeId ? null : r.label.trim() || 'Core costs',
              amount: amount(r),
            })),
        },
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await router.invalidate()
    } catch (e) {
      setError(messageFor(e))
    } finally {
      setSaving(false)
    }
  }

  // Drawn from the same function the Finance panel uses, so the two screens cannot
  // disagree about what a budget line means.
  const preview = rollUpBudget(
    rows
      .filter((r) => amount(r) > 0)
      .map((r) => ({
        programmeId: r.programmeId,
        label: r.label,
        amount: amount(r),
      })),
    [],
  )

  return (
    <SettingsPage
      title="Annual budget"
      description="What your organisation plans to give away this financial year, by programme, plus the cost of running it. Finance shows your commitments against these figures."
    >
      <Panel label="Tracking">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-display text-body font-medium" style={{ color: C.ink }}>
              Track a budget and bank balance
            </p>
            <p className="mt-1 font-display text-body" style={{ color: C.sub }}>
              Adds a <span className="font-medium">Balance &amp; budget</span> screen to Finance.
              Turning this off hides it and everything below — your figures are kept, and come back
              exactly as they were.
            </p>
          </div>
          <Toggle
            checked={visible}
            onChange={handleVisibility}
            label="Track a budget and bank balance"
          />
        </div>
        <ErrorNote error={error} className="mt-3" />
      </Panel>

      {!visible ? null : (
        <>
          <Panel label="Financial year">
            <PanelTitle>Financial year</PanelTitle>
            <div className="flex flex-wrap items-end gap-4">
              <div className="w-full sm:w-64">
                <Label htmlFor="fy-end">Our financial year ends in</Label>
                <Select
                  id="fy-end"
                  value={String(endMonth)}
                  options={MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }))}
                  onChange={(v) => handleSaveYearEnd(Number(v))}
                />
              </div>
              <p className="font-display text-body" style={{ color: C.sub }}>
                This year runs {financialYearRange(data.financialYear)}.
              </p>
            </div>
            {/* Saying this plainly is cheaper than the support email: a foundation that
            changes its year end will otherwise assume last year's figures moved with it. */}
            <p className="mt-3 font-display text-label" style={{ color: C.faint }}>
              Budgets already saved keep the year they were set for — changing this only affects how
              future years are worked out.
            </p>
          </Panel>

          <Panel label={`Budget for ${data.financialYear.label}`}>
            <PanelTitle
              right={
                allocatedInRounds > 0 && (
                  <Button variant="text" size="sm" onClick={useRoundAllocations}>
                    Use round allocations
                  </Button>
                )
              }
            >
              Budget for {data.financialYear.label}
            </PanelTitle>
            <div className="flex flex-col gap-3">
              {rows.map((row, i) => {
                const allocated = row.programmeId
                  ? allocatedByProgramme.get(row.programmeId)
                  : undefined
                return (
                  <div key={row.key} className="flex items-end gap-3">
                    <div className="min-w-0 flex-1">
                      {row.programmeId ? (
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-[2px]"
                            style={{ backgroundColor: resolveProgrammeColour(row.colour, i) }}
                          />
                          <span className="truncate font-display text-body text-grey-900">
                            {row.label}
                          </span>
                        </div>
                      ) : (
                        <Input
                          value={row.label}
                          aria-label="Name of this cost line"
                          placeholder="Core costs"
                          maxLength={80}
                          onChange={(e) => patch(row.key, { label: e.target.value })}
                        />
                      )}
                      {allocated !== undefined && (
                        <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
                          {fmtMoney(allocated)} allocated across this year&rsquo;s rounds
                        </p>
                      )}
                    </div>

                    <MoneyInput
                      className="w-40 shrink-0"
                      value={row.amount}
                      label={`Budget for ${row.label || 'this line'}`}
                      placeholder="Not budgeted"
                      onChange={(v) => {
                        patch(row.key, { amount: v })
                        setSaved(false)
                      }}
                    />

                    {/* Only the non-grant lines can be removed. A programme row is not the
                    foundation's to delete here — it is deleted by archiving the
                    programme, and an empty amount already says "nothing this year". */}
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                      aria-label={`Remove ${row.label || 'this line'}`}
                      disabled={!!row.programmeId}
                      className="mb-2 flex shrink-0 rounded-full p-1 text-danger transition-opacity hover:opacity-70 disabled:invisible"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={20} color="currentColor" />
                    </button>
                  </div>
                )
              })}
            </div>

            <Button
              variant="text"
              size="sm"
              className="mt-3"
              onClick={() => setRows((rs) => [...rs, newCoreRow('')])}
            >
              <HugeiconsIcon icon={Add01Icon} size={16} color="currentColor" />
              Add a cost line
            </Button>

            {data.programmes.length === 0 && (
              <p className="mt-3 font-display text-body" style={{ color: C.faint }}>
                You have no programmes yet. Add them first and their budgets will appear here.
              </p>
            )}
          </Panel>

          <Panel label="Check">
            <PanelTitle>Check</PanelTitle>
            <dl className="flex flex-col gap-2">
              <CheckRow label="Grant-making budget" value={fmtMoney(grantMaking)} />
              <CheckRow label="Core costs" value={fmtMoney(coreCosts)} />
              <CheckRow label="Total annual budget" value={fmtMoney(total)} strong />
            </dl>

            {/* The check that cannot exist without an annual figure to check against. */}
            <div className="mt-4 border-t pt-4" style={{ borderColor: C.line }}>
              <Reconciliation grantMaking={grantMaking} allocated={allocatedInRounds} />
            </div>

            {preview.lines.length > 0 && (
              <p className="mt-3 font-display text-label" style={{ color: C.faint }}>
                {preview.lines.length} line{preview.lines.length === 1 ? '' : 's'} will be saved.
                Lines left blank are not saved.
              </p>
            )}

            {removing && (
              <p className="mt-3 font-display text-body" style={{ color: C.sub }}>
                Every amount is blank, so saving will remove this year&rsquo;s budget. Finance will
                stop showing commitments against it.
              </p>
            )}
            <ErrorNote error={error} className="mt-3" />
            <Button
              onClick={handleSave}
              disabled={saving || !dirty}
              variant={removing ? 'danger' : 'primary'}
              className="mt-3"
            >
              {saving
                ? removing
                  ? 'Removing…'
                  : 'Saving…'
                : saved
                  ? 'Saved'
                  : removing
                    ? 'Remove budget'
                    : 'Save budget'}
            </Button>
          </Panel>
        </>
      )}
    </SettingsPage>
  )
}

function CheckRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 font-display text-body">
      <dt style={{ color: strong ? C.ink : C.sub }}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-medium' : ''}`} style={{ color: C.ink }}>
        {value}
      </dd>
    </div>
  )
}

/**
 * Grant-making budget against what the year's rounds have actually allocated.
 *
 * Advice, never a gate — the two figures are allowed to differ, and the common reasons
 * are good ones (money held back for unsolicited grants, a round that has not been set
 * up yet). So it states the gap and names the likely reason rather than flagging an
 * error.
 */
function Reconciliation({ grantMaking, allocated }: { grantMaking: number; allocated: number }) {
  if (grantMaking === 0 && allocated === 0) {
    return (
      <p className="font-display text-body" style={{ color: C.faint }}>
        Once you have budgeted here and set round budgets, this will check the two against each
        other.
      </p>
    )
  }

  const gap = grantMaking - allocated
  const tone = gap < 0 ? C.danger : C.sub

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-3 font-display text-body">
        <span style={{ color: C.sub }}>This year&rsquo;s rounds have allocated</span>
        <span className="font-medium tabular-nums" style={{ color: C.ink }}>
          {fmtMoney(allocated)} of {fmtMoney(grantMaking)}
        </span>
      </div>
      <p className="font-display text-label" style={{ color: tone }}>
        {gap === 0
          ? 'Fully allocated — your round budgets match your grant-making budget exactly.'
          : gap > 0
            ? `${fmtMoney(gap)} is not yet in any round — held back, or a round still to be set up.`
            : `Your rounds allocate ${fmtMoney(-gap)} more than you have budgeted for the year.`}
      </p>
    </div>
  )
}
