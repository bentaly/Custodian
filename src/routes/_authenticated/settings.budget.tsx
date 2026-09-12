import { useMemo, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons'
import {
  getAnnualBudgetSettings,
  saveAnnualBudget,
  saveFinancialYearEndMonth,
} from '../../server/fns/budget'
import {
  Button,
  DateField,
  ErrorNote,
  Input,
  Label,
  MoneyInput,
  Panel,
  PanelTitle,
  Select,
  TOKENS as C,
  UnsavedChangesGuard,
} from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'
import { canSeePayments } from '../../lib/roles'
import { MONTH_NAMES, financialYear, financialYearRange } from '../../lib/financialYear'
import { CORE_COSTS_LABEL, rollUpBudget } from '../../lib/annualBudget'
import {
  COST_FREQUENCIES,
  COST_LABEL_SUGGESTIONS,
  annualFromForm,
  costTimingProblem,
  formAmount,
  monthsOfYear,
  scheduleCoreCosts,
  type CostFrequency,
} from '../../lib/coreCosts'
import { rollUpCash } from '../../lib/multiYear'
import { todayIso } from '../../lib/schedule'
import { fmtDate, fmtMoney } from '../../lib/format'
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
 * ## Core and other costs say how they are paid
 *
 * A non-grant line is monthly (rent, payroll) or one-off (a legal fee, on a date), and
 * Finance uses that to place it through the year (`src/lib/coreCosts.ts`). A monthly line
 * is TYPED per month, because that is the figure a finance lead knows, and STORED as the
 * year — `annual_budget_lines.amount` means the same thing on every line. The label is
 * free text with suggestions (Staff, Premises, Misc.…) rather than a fixed category list.
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
  // The year is a search param, so a particular year is a link somebody can send, the
  // back button steps through years, and a reload stays where they were.
  validateSearch: (search: Record<string, unknown>) => ({
    // Offsets from the current financial year: five back, one forward. Bounded here as
    // well as on the server so a hand-typed URL cannot wander off into empty years.
    year:
      Number.isInteger(Number(search.year)) && Number(search.year) >= -5 && Number(search.year) <= 1
        ? Number(search.year)
        : undefined,
  }),
  loaderDeps: ({ search }) => ({ year: search.year }),
  loader: async ({ deps }) => ({
    data: await getAnnualBudgetSettings({ data: { yearOffset: deps.year ?? 0 } }),
  }),
  component: AnnualBudget,
})

type Row = {
  key: string
  programmeId: string | null
  label: string
  colour: string | null
  /**
   * The figure as typed — per MONTH on a monthly cost line, for the year everywhere else.
   * `amount()` in the component turns it into the year's figure, which is what is saved.
   */
  amount: string
  /**
   * What this programme already owes this year from grants decided in earlier years.
   *
   * Empty string means "the derived figure is right" and stores NULL — which is the
   * normal case, because the figure is computed from instalment dates Custodian already
   * holds. A typed value is an override: a foundation holding a contingency back, or
   * treating one grant's future instalments differently. Always shown beside the derived
   * figure rather than replacing it, so an override reads as a deliberate choice against
   * a number still on screen.
   */
  promised: string
  /** Cost lines only. */
  frequency: CostFrequency
  /** Cost lines only: a one-off's `yyyy-mm-dd`, or '' until picked. */
  dueDate: string
  /**
   * A monthly line's stored YEAR figure, kept until its per-month field is edited.
   *
   * A year shown per month is rounded to the penny (£50,000 is £4,166.67 a month), and
   * twelve of those is £50,000.04. Without this, saving any OTHER change on the screen
   * would quietly move an untouched cost line by a few pence.
   */
  loadedAnnual: number | null
}

/**
 * The shared column template for the budget lists: name, the two fields, the remove
 * button's slot. One constant so the header cannot drift out of line with the rows.
 *
 * One column at phone width, where the fields stack and each carries its own label.
 */
const BUDGET_GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_2.25rem]'

const LABEL_SUGGESTIONS_ID = 'budget-cost-label-suggestions'

let coreKey = 0
const newCoreRow = (label: string = CORE_COSTS_LABEL): Row => ({
  key: `core-${coreKey++}`,
  programmeId: null,
  promised: '',
  label,
  colour: null,
  amount: '',
  frequency: 'monthly',
  dueDate: '',
  loadedAnnual: null,
})

/**
 * Keyed on the year, so stepping to another one rebuilds the form from scratch.
 *
 * The row state is seeded from the loaded budget ONCE, which is right within a year — a
 * save reloads the data and the edits stay put rather than being yanked out from under
 * whoever is looking at them. Across years it is wrong: without the key, stepping to
 * 2025/26 would leave this year's figures sitting in the fields, ready to be saved into
 * the wrong year.
 */
function AnnualBudget() {
  const { data } = Route.useLoaderData()
  return <AnnualBudgetYear key={data.financialYear.start} data={data} />
}

function AnnualBudgetYear({ data }: { data: Awaited<ReturnType<typeof getAnnualBudgetSettings>> }) {
  const router = useRouter()
  const navigate = Route.useNavigate()
  const offset = data.yearOffset
  const currentYearLabel = financialYear(data.financialYearEndMonth).label
  const monthCount = monthsOfYear(data.financialYear).length

  /**
   * Step or jump to another financial year.
   *
   * The year is a search param, so a particular year is a link somebody can send and the
   * back button walks them. Guarded on `dirty` at the control rather than here, because a
   * disabled arrow with "Save your changes first" on it says more than a dialog fired
   * after the click.
   */
  const goToYear = (to: number) => navigate({ search: { year: to === 0 ? undefined : to } })

  // Every active programme gets a row whether or not it is in the saved budget: the
  // screen is "what is this year's money", and a programme missing from the form reads
  // as a programme that no longer exists rather than one funded nothing.
  const initialRows = useMemo<Row[]>(() => {
    const saved = new Map(data.lines.filter((l) => l.programmeId).map((l) => [l.programmeId!, l]))
    const programmeRows: Row[] = data.programmes.map((p) => ({
      ...newCoreRow(p.name),
      key: p.id,
      programmeId: p.id,
      colour: p.colour,
      amount: saved.has(p.id) ? String(saved.get(p.id)!.amount) : '',
      promised:
        saved.get(p.id)?.carriedCommitment != null
          ? String(saved.get(p.id)!.carriedCommitment)
          : '',
    }))
    const coreRows: Row[] = data.lines
      .filter((l) => !l.programmeId)
      .map((l) => {
        const frequency = l.frequency ?? 'monthly'
        const { typed, loadedAnnual } = formAmount(l.amount, frequency, monthCount)
        return {
          ...newCoreRow(l.label ?? CORE_COSTS_LABEL),
          frequency,
          dueDate: l.dueDate ?? '',
          amount: typed,
          loadedAnnual,
        }
      })
    return [...programmeRows, ...(coreRows.length > 0 ? coreRows : [newCoreRow()])]
  }, [data, monthCount])

  const [rows, setRows] = useState<Row[]>(initialRows)
  const [endMonth, setEndMonth] = useState(data.financialYearEndMonth)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const allocatedByProgramme = useMemo(
    () => new Map(data.roundAllocations.map((a) => [a.programmeId, a.allocated])),
    [data.roundAllocations],
  )
  // Cash already owed this year against grants decided in earlier years, per programme.
  // Derived server-side from instalment dates, so it needs no input to be right.
  const promisedByProgramme = useMemo(
    () => new Map(data.promisedFromEarlierYears.map((p) => [p.programmeId, p.promised])),
    [data.promisedFromEarlierYears],
  )

  /**
   * The YEAR's figure for a row — what is saved and what every total adds up. A programme
   * line is typed as the year, so it converts the way a one-off does.
   */
  const amount = (r: Row) =>
    annualFromForm(
      r.amount,
      r.programmeId ? 'one_off' : r.frequency,
      monthCount,
      r.programmeId ? null : r.loadedAnnual,
    )
  /** The typed override, or null when the derived figure was accepted. */
  const promisedOverride = (r: Row): number | null => {
    if (!r.programmeId || r.promised.trim() === '') return null
    const n = parseFloat(r.promised)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  /** The figure in use for a row: the override if there is one, else the derived one. */
  const promisedOf = (r: Row): number =>
    promisedOverride(r) ?? (r.programmeId ? (promisedByProgramme.get(r.programmeId) ?? 0) : 0)
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
          r.programmeId ? null : r.label.trim() || CORE_COSTS_LABEL,
          amount(r),
          // The override is part of what a save writes, so editing it alone has to enable
          // Save. Compared as the payload value (null for "derived figure is right"), not
          // as the raw field, so typing the derived figure back in still reads as clean.
          promisedOverride(r),
          r.programmeId ? null : r.frequency,
          !r.programmeId && r.frequency === 'one_off' ? r.dueDate || null : null,
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
  // The rule `saveAnnualBudget` refuses on, run here too so Save is never a button that
  // fails: a one-off cost needs a date inside the year.
  const timingProblem = costTimingProblem(
    rows.map((r) => ({
      programmeId: r.programmeId,
      label: r.label,
      amount: amount(r),
      frequency: r.frequency,
      dueDate: r.dueDate,
    })),
    data.financialYear,
  )

  const programmeRows = rows.filter((r) => r.programmeId)
  const costRows = rows.filter((r) => !r.programmeId)
  // "Available to award" and the red "allocated to rounds — £X over" line, per programme.
  // Read off `rollUpCash`, the rollup Finance draws its cash view with, so the arithmetic
  // is stated and tested once (`multiYear.test.ts`) rather than re-derived in a component.
  const cashByProgramme = new Map(
    rollUpCash(
      programmeRows.map((r) => ({
        programmeId: r.programmeId,
        amount: amount(r),
        carriedCommitment: promisedOverride(r),
      })),
      new Map(),
      promisedByProgramme,
      allocatedByProgramme,
    ).lines.map((l) => [l.programmeId, l]),
  )

  const total = rows.reduce((s, r) => s + amount(r), 0)
  const coreCosts = costRows.reduce((s, r) => s + amount(r), 0)
  const grantMaking = total - coreCosts
  const allocatedInRounds = data.roundAllocations.reduce((s, a) => s + a.allocated, 0)
  // Prior commitments across every programme line — the stated figure where there is one,
  // else the one derived from the instalment dates.
  const promisedTotal = programmeRows.reduce((s, r) => s + promisedOf(r), 0)
  // The same function Finance places them with, so "£2,100 a month" here is the figure
  // the cash flow there is built from.
  const costPlan = scheduleCoreCosts(
    costRows
      .filter((r) => amount(r) > 0)
      .map((r) => ({
        label: r.label,
        amount: amount(r),
        frequency: r.frequency,
        dueDate: r.dueDate || null,
      })),
    data.financialYear,
    todayIso(),
  )

  const patch = (key: string, next: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)))
    setSaved(false)
  }

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
   * Save the financial year end the moment it is picked.
   *
   * Organisation-wide config rather than part of this year's budget, so it does not wait
   * for the budget's Save — and every year on the page is derived from it.
   */
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
              label: r.programmeId ? null : r.label.trim() || CORE_COSTS_LABEL,
              amount: amount(r),
              carriedCommitment: promisedOverride(r),
              frequency: r.programmeId ? null : r.frequency,
              dueDate: !r.programmeId && r.frequency === 'one_off' ? r.dueDate || null : null,
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

  const costSummary = [
    costPlan.perMonth > 0 && `${fmtMoney(costPlan.perMonth)} a month`,
    costPlan.oneOff > 0 && `${fmtMoney(costPlan.oneOff)} one-off`,
  ]
    .filter(Boolean)
    .join(' + ')

  return (
    <SettingsPage
      title="Annual budget"
      description="What your organisation plans to give away this financial year, by programme, plus the cost of running it. Finance shows your commitments and cash flow against these figures."
    >
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
          {/* The arrows straddle the YEAR, not the panel: a stepper sitting across the
              thing it changes needs no label to say what it steps. "Budget for" stays
              outside them — it is not part of what moves. */}
          <span className="inline-flex items-center gap-1">
            Budget for
            <Button
              variant="ghost"
              size="xs"
              icon={ArrowLeft01Icon}
              aria-label="Previous financial year"
              title={dirty ? 'Save your changes first' : 'Previous financial year'}
              disabled={dirty || offset <= -5}
              onClick={() => goToYear(offset - 1)}
            />
            <span className="tabular-nums">{data.financialYear.label}</span>
            <Button
              variant="ghost"
              size="xs"
              icon={ArrowRight01Icon}
              aria-label="Next financial year"
              title={dirty ? 'Save your changes first' : 'Next financial year'}
              disabled={dirty || offset >= 1}
              onClick={() => goToYear(offset + 1)}
            />
            {/* Named, not "This year": a button reading "This year" beside a heading
                reading "Budget for 2025/26" makes two claims about which year you are on.
                Beside the arrows rather than across the panel, because it belongs to the
                same control — but outside them, because it JUMPS rather than steps. */}
            {offset !== 0 && (
              <Button
                variant="text"
                size="xs"
                className="ml-1"
                disabled={dirty}
                onClick={() => goToYear(0)}
              >
                Back to {currentYearLabel}
              </Button>
            )}
          </span>
        </PanelTitle>
        {/* Which year you are editing, said in words as well as in the stepper. The panel
            heading carries the label, but a foundation that has stepped back a year is
            about to type figures into a year that is not the current one, and "2025/26"
            alone does not say that loudly enough. */}
        {offset !== 0 && (
          <p className="-mt-1 font-display text-label" style={{ color: C.amber }}>
            {offset < 0
              ? `You are editing a past year. Finance reports ${data.financialYear.label} against these figures, so changing them here changes the record.`
              : `You are setting next year's budget before it starts. Nothing reports against it until ${data.financialYear.label} begins.`}
          </p>
        )}
        {/* Two money fields on a row need naming, and the names belong over the columns
            rather than inside each field: repeated per row they would be twenty labels
            saying the same two things. Hidden below `sm`, where the fields stack and each
            one's own accessible label is what reads. */}
        <div className={`${BUDGET_GRID} hidden items-end sm:grid`}>
          <span />
          <ColumnLabel>Available budget</ColumnLabel>
          <ColumnLabel>Prior commitment total</ColumnLabel>
          <span />
        </div>
        <div className="flex flex-col gap-3">
          {programmeRows.map((row, i) => {
            const cash = cashByProgramme.get(row.programmeId!)
            const derived = promisedByProgramme.get(row.programmeId!) ?? 0
            const overridden = promisedOverride(row) !== null
            return (
              <div key={row.key} className={`${BUDGET_GRID} items-end`}>
                <div className="min-w-0 flex-1">
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
                  {/* The pair this screen exists to state: what is genuinely free to give
                      this year, and how much of that the rounds have taken. The derived
                      figure stays visible next to an override rather than being replaced
                      by it, so a buffer reads as a deliberate choice. */}
                  {amount(row) > 0 && (
                    <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
                      <span style={{ color: C.sub }}>
                        {fmtMoney(cash?.free ?? 0)} available to award
                      </span>
                      {/* What the rounds have taken of it. Over it is the thing this screen
                          exists to catch — the rounds between them promising more than the
                          year has free — so it is said in words and in red rather than left
                          for the reader to subtract. */}
                      {cash && cash.allocated > 0 && (
                        <>
                          {' · '}
                          <span style={{ color: cash.unallocated < 0 ? C.danger : C.faint }}>
                            {fmtMoney(cash.allocated)} allocated to rounds
                            {cash.unallocated < 0 && ` — ${fmtMoney(-cash.unallocated)} over`}
                          </span>
                        </>
                      )}
                      {overridden && <> · {fmtMoney(derived)} from the schedules</>}
                    </p>
                  )}
                </div>

                <MoneyInput
                  value={row.amount}
                  label={`Available budget for ${row.label}`}
                  placeholder="Not budgeted"
                  onChange={(v) => patch(row.key, { amount: v })}
                />

                {/* Empty is not zero: it means "your figure is right", and the derived one
                    shows as the placeholder so the field reads as pre-answered rather than
                    as one more thing to fill in. */}
                <MoneyInput
                  value={row.promised}
                  label={`Prior commitments to be paid this year for ${row.label}`}
                  placeholder={derived > 0 ? String(derived) : '0'}
                  onChange={(v) => patch(row.key, { promised: v })}
                />

                {/* A programme row is not the foundation's to delete here — it is deleted by
                    archiving the programme, and an empty amount already says "nothing this
                    year". The slot stays so the columns line up with the cost lines. */}
                <span />
              </div>
            )
          })}
        </div>

        {data.programmes.length === 0 && (
          <p className="mt-3 font-display text-body" style={{ color: C.faint }}>
            You have no programmes yet. Add them first and their budgets will appear here.
          </p>
        )}

        {/* Its own list with its own column names, because the second column means
            something different here: not a prior commitment (there are no grants behind a
            cost) but how the money is paid, which is what places it in Finance's cash
            flow. */}
        <div className="mt-6 border-t pt-4" style={{ borderColor: C.line }}>
          <h3 className="font-display text-body font-medium" style={{ color: C.ink }}>
            Core and other costs
          </h3>
          <p className="mt-0.5 mb-3 font-display text-label" style={{ color: C.faint }}>
            Running the foundation, and anything else that is not a grant. Say how each is paid and
            Finance will place it through the year.
          </p>
          <datalist id={LABEL_SUGGESTIONS_ID}>
            {COST_LABEL_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className={`${BUDGET_GRID} hidden items-end sm:grid`}>
            <span />
            <ColumnLabel>Amount</ColumnLabel>
            <ColumnLabel>How often</ColumnLabel>
            <span />
          </div>
          <div className="flex flex-col gap-3">
            {costRows.map((row) => (
              <div key={row.key} className={`${BUDGET_GRID} items-start`}>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Input
                    value={row.label}
                    list={LABEL_SUGGESTIONS_ID}
                    aria-label="Name of this cost line"
                    placeholder="Core costs, Staff, Misc.…"
                    maxLength={80}
                    onChange={(e) => patch(row.key, { label: e.target.value })}
                  />
                  {row.frequency === 'one_off' ? (
                    <DateField
                      size="sm"
                      value={row.dueDate}
                      min={data.financialYear.start}
                      max={data.financialYear.end}
                      placeholder="When is it paid?"
                      aria-label={`Date ${row.label || 'this cost'} is paid`}
                      onChange={(v) => patch(row.key, { dueDate: v })}
                    />
                  ) : (
                    amount(row) > 0 && (
                      <p className="font-display text-label" style={{ color: C.faint }}>
                        {fmtMoney(amount(row))} over the year
                      </p>
                    )
                  )}
                </div>

                <MoneyInput
                  value={row.amount}
                  label={
                    row.frequency === 'monthly'
                      ? `Monthly amount for ${row.label || 'this line'}`
                      : `Amount for ${row.label || 'this line'}`
                  }
                  suffix={row.frequency === 'monthly' ? '/month' : undefined}
                  placeholder="0"
                  // Editing the figure drops the loaded year — from here on the typed
                  // monthly figure is the truth.
                  onChange={(v) => patch(row.key, { amount: v, loadedAnnual: null })}
                />

                {/* Switching keeps the typed figure rather than converting it: somebody who
                    typed 2,000 and then says "monthly" means £2,000 a month. The caption
                    under the name shows the year it now comes to. */}
                <Select
                  aria-label={`How often ${row.label || 'this cost'} is paid`}
                  value={row.frequency}
                  options={COST_FREQUENCIES}
                  onChange={(v) =>
                    patch(row.key, { frequency: v as CostFrequency, loadedAnnual: null })
                  }
                />

                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                  aria-label={`Remove ${row.label || 'this line'}`}
                  className="mt-2 flex shrink-0 rounded-full p-1 text-danger transition-opacity hover:opacity-70"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={20} color="currentColor" />
                </button>
              </div>
            ))}
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
        </div>
      </Panel>

      <Panel label="Check">
        <PanelTitle>Check</PanelTitle>
        <dl className="flex flex-col gap-2">
          {/* The grant-making figure split into the two things it is actually made of. One
              line reading "Grant-making budget" hid that part of it is already spoken for
              before a single round opens. */}
          <CheckRow
            label={`Available grant-making budget for ${data.financialYear.label}`}
            value={fmtMoney(grantMaking)}
          />
          <CheckRow
            label={`Prior grant commitments to be paid in ${data.financialYear.label}`}
            value={fmtMoney(promisedTotal)}
          />
          <CheckRow label="Core and other costs" value={fmtMoney(coreCosts)} sub={costSummary} />
          <CheckRow label="Total annual budget" value={fmtMoney(total)} strong />
        </dl>

        {/* The check that cannot exist without an annual figure to check against. */}
        <div className="mt-4 border-t pt-4" style={{ borderColor: C.line }}>
          <Reconciliation grantMaking={grantMaking} allocated={allocatedInRounds} />
        </div>

        {preview.lines.length > 0 && (
          <p className="mt-3 font-display text-label" style={{ color: C.faint }}>
            {preview.lines.length} line{preview.lines.length === 1 ? '' : 's'} will be saved. Lines
            left blank are not saved.
          </p>
        )}

        {removing && (
          <p className="mt-3 font-display text-body" style={{ color: C.sub }}>
            Every amount is blank, so saving will remove this year&rsquo;s budget. Finance will stop
            showing commitments against it.
          </p>
        )}
        {timingProblem && (
          <p className="mt-3 font-display text-body" style={{ color: C.danger }}>
            {timingProblem}
          </p>
        )}
        <ErrorNote error={error} className="mt-3" />
        <Button
          onClick={handleSave}
          disabled={saving || !dirty || !!timingProblem}
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
        {/* Saving IS confirming the year's figures, so the screen says who last did it. */}
        {data.lastSaved && (
          <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
            Last saved{data.lastSaved.by ? ` by ${data.lastSaved.by}` : ''} on{' '}
            {fmtDate(data.lastSaved.at)}.
          </p>
        )}
      </Panel>
      {/* Disabling the year arrows only ever covered stepping between years; the sidebar,
          a breadcrumb and the browser's back button all still walked away with an
          afternoon's typing. */}
      <UnsavedChangesGuard dirty={dirty} what={`the ${data.financialYear.label} budget`} />
    </SettingsPage>
  )
}

function ColumnLabel({ children }: { children: string }) {
  return (
    <span className="font-display text-label" style={{ color: C.faint }}>
      {children}
    </span>
  )
}

function CheckRow({
  label,
  value,
  sub,
  strong,
}: {
  label: string
  value: string
  sub?: string
  strong?: boolean
}) {
  return (
    <div className="flex justify-between gap-3 font-display text-body">
      <dt style={{ color: strong ? C.ink : C.sub }}>
        {label}
        {sub && (
          <span className="ml-2 text-label" style={{ color: C.faint }}>
            {sub}
          </span>
        )}
      </dt>
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
