import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  PlusSignIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import {
  createAwards,
  getAwardLetterSettings,
  type AwardCandidate,
} from '../../server/fns/awardSetup'
import { AwardLetterPreview } from '../AwardLetterPreview'
import { Button, DateField, Dialog, ErrorNote, Input, Textarea } from '../ui'
import { C } from '../ui/tokens'
import {
  DEFAULT_GRANT_CONDITIONS,
  renderAwardLetter,
  type AwardLetterInput,
} from '../../lib/awardLetter'
import { CADENCES, buildSchedule, cadenceMonths, type CadenceKey } from '../../lib/awardSchedule'
import { fmtDate, fmtMoney, fmtRef } from '../../lib/format'
import { todayIso } from '../../lib/schedule'
import { longerTimeout } from '../../lib/requestTimeout'

// The award set-up flow, as a modal over the queue it was launched from (Figma
// 584:26208 / 604:1314 / 610:1919). Three steps: terms once, then each grant, then the
// letters — because a board sitting settles the shared terms in one breath and only
// the amount, purpose and any bespoke condition differ per grant.

type LetterSettings = Awaited<ReturnType<typeof getAwardLetterSettings>>

/** The batch's shared terms. */
type Terms = {
  /** When the grant period begins — what the letter states and the award stores. */
  startDate: string
  /**
   * When the first instalment falls due. Separate from the start date because a grant
   * beginning 1 September that pays a month in arrears is ordinary, and one field
   * cannot express it. It follows the start date until it is set to differ.
   */
  firstPaymentDate: string
  /** 1–3 even instalments, or `custom` — a hand-edited split per grant. */
  structure: 1 | 2 | 3 | 'custom'
  cadence: CadenceKey
  useStandardConditions: boolean
  reporting: Array<{ label: string; date: string }>
}

type GrantState = {
  amount: string
  purpose: string
  /** Terms specific to this grant. Each becomes its own numbered clause on the letter. */
  conditions: string[]
  /** Hand-edited rows, used only while `structure` is `custom`. */
  rows: Array<{ amount: string; date: string }>
}

const STEPS = [
  { n: 1, label: 'Terms' },
  { n: 2, label: 'Grant details' },
  { n: 3, label: 'Award letters' },
] as const

// ─── Small shared pieces ────────────────────────────────────────────────────────

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const done = step > s.n
        const active = step === s.n
        return (
          <div key={s.n} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full font-display text-label font-medium transition-colors duration-300"
              style={{
                backgroundColor: done || active ? C.brand : C.wash,
                color: done || active ? '#fff' : C.faint,
              }}
            >
              {done ? <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2.5} /> : s.n}
            </span>
            <span
              className="shrink-0 font-display text-body font-medium"
              style={{ color: done || active ? C.ink : C.faint }}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              // A track that fills left to right as the step it leads out of completes,
              // so the connector travels towards the step you have just moved to rather
              // than flicking green behind you.
              <span
                className="h-[2px] min-w-4 flex-1 overflow-hidden rounded-full"
                style={{ backgroundColor: C.line }}
              >
                <span
                  className="block h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: done ? '100%' : '0%', backgroundColor: C.brand }}
                />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The washed track + white active pill the app's tabs use, as a form control. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-chip p-0.5"
      style={{ backgroundColor: C.wash }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className="flex h-8 shrink-0 items-center rounded-chip px-3 font-display text-body font-medium"
            style={
              on
                ? { backgroundColor: '#fff', border: `1px solid ${C.line}`, color: C.ink }
                : { color: C.sub }
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 font-display text-label" style={{ color: C.sub }}>
      {children}
    </div>
  )
}

function StatePill({ tone, children }: { tone: 'ready' | 'todo'; children: React.ReactNode }) {
  const ready = tone === 'ready'
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2"
      style={{ backgroundColor: ready ? C.brandBg : C.amberWash }}
    >
      <span
        className="size-[3px] rounded-full"
        style={{ backgroundColor: ready ? C.brand : C.amber }}
      />
      <span
        className="font-display text-micro font-medium"
        style={{ color: ready ? C.brand : C.amber }}
      >
        {children}
      </span>
    </span>
  )
}

/**
 * The even split of a grant's total across its rows — the same rule `buildSchedule`
 * uses, with the rounding remainder in the final instalment, so "Split evenly" and the
 * derived structures never disagree about what even means.
 */
function evenSplit(g: GrantState): number[] {
  const total = parseFloat(g.amount) || 0
  const n = g.rows.length
  if (n === 0) return []
  const base = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - base * (n - 1) : base))
}

/** Whether the rows already carry that split — a button that would do nothing is off. */
function isEvenSplit(g: GrantState): boolean {
  const even = evenSplit(g)
  if (even.length === 0) return true
  return g.rows.every((r, i) => Math.abs((parseFloat(r.amount) || 0) - even[i]!) < 0.005)
}

/** A grant's duration, in the comps' words. */
function durationLabel(years: number | null): string | null {
  if (!years || years <= 0) return null
  return `Over ${years * 12} months`
}

// ─── The wizard ─────────────────────────────────────────────────────────────────

export function AwardWizard({
  candidates,
  letterSettings,
  onClose,
  onDone,
}: {
  /** The grants this run is setting up — one row clicked, or a multi-selection. */
  candidates: AwardCandidate[]
  letterSettings: LetterSettings
  onClose: () => void
  onDone: (result: Awaited<ReturnType<typeof createAwards>>) => void
}) {
  const [step, setStep] = useState(1)
  const [terms, setTerms] = useState<Terms>(() => ({
    startDate: todayIso(),
    firstPaymentDate: todayIso(),
    structure: 1,
    cadence: 'yearly',
    useStandardConditions: true,
    // One empty row, because a grant must carry at least one reporting date: the
    // requirement shows as a field waiting to be filled rather than only as a message
    // under a disabled button.
    reporting: [{ label: '', date: '' }],
  }))
  const [grants, setGrants] = useState<Record<string, GrantState>>(() =>
    Object.fromEntries(
      candidates.map((c) => [
        c.id,
        {
          amount: String(c.amountRequested),
          // Pre-filled from the application's grant purpose, then edited freely: what
          // ends up here is what the grantee's letter says, so the admin gets the last
          // word. The edit stays on the award — the application keeps the AI's wording.
          purpose: c.grantPurpose ?? '',
          // One empty row so the field is visible without being hunted for; blanks are
          // dropped on submit, so an untouched grant carries no bespoke condition.
          conditions: [''],
          rows: [],
        },
      ]),
    ),
  )
  const [letterOpen, setLetterOpen] = useState(false)
  const [letterIndex, setLetterIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const conditions = letterSettings?.conditions ?? DEFAULT_GRANT_CONDITIONS
  const custom = terms.structure === 'custom'

  function setGrant(id: string, patch: Partial<GrantState>) {
    setGrants((g) => ({ ...g, [id]: { ...g[id]!, ...patch } }))
  }

  /** The schedule for one grant: derived from the shared terms unless hand-edited. */
  function scheduleFor(c: AwardCandidate): Array<{ amount: number; date: string | null }> {
    const g = grants[c.id]!
    if (terms.structure === 'custom') {
      return g.rows.map((r) => ({ amount: parseFloat(r.amount) || 0, date: r.date || null }))
    }
    return buildSchedule(
      parseFloat(g.amount) || 0,
      terms.structure,
      terms.firstPaymentDate || null,
      cadenceMonths(terms.cadence),
    )
  }

  /**
   * The first payment tracks the start date while the two agree — moving a batch's
   * start date almost always means moving its payments — and stops the moment an
   * admin sets it to something of its own.
   */
  function setStartDate(next: string) {
    setTerms((t) => ({
      ...t,
      startDate: next,
      firstPaymentDate: t.firstPaymentDate === t.startDate ? next : t.firstPaymentDate,
    }))
  }

  /**
   * Switching to Custom hands the derived rows over pre-filled, so a hand-edited split
   * starts from what the admin was already looking at rather than an empty table.
   */
  function setStructure(next: Terms['structure']) {
    const from = terms.structure
    if (next === 'custom' && from !== 'custom') {
      setGrants((state) => {
        const seeded = { ...state }
        for (const c of candidates) {
          const g = state[c.id]!
          const rows = buildSchedule(
            parseFloat(g.amount) || 0,
            from,
            terms.firstPaymentDate || null,
            cadenceMonths(terms.cadence),
          ).map((r) => ({ amount: String(r.amount), date: r.date ?? '' }))
          seeded[c.id] = { ...g, rows }
        }
        return seeded
      })
    }
    setTerms((t) => ({ ...t, structure: next }))
  }

  /** Re-split a grant's total evenly across its rows, keeping the dates. */
  function splitEvenly(c: AwardCandidate) {
    const g = grants[c.id]!
    setGrant(c.id, {
      rows: g.rows.map((r, i) => ({ ...r, amount: String(evenSplit(g)[i] ?? 0) })),
    })
  }

  function letterFor(c: AwardCandidate) {
    const g = grants[c.id]!
    const input: AwardLetterInput = {
      organisationName: c.organisationName,
      foundationName: letterSettings?.foundationName ?? 'the Foundation',
      amountAwarded: parseFloat(g.amount) || 0,
      purpose: g.purpose || null,
      startDate: terms.startDate || null,
      programmeName: c.programmeName,
      roundName: c.roundName,
      reference: c.externalApplicationId,
      instalments: scheduleFor(c).map((r) => ({ amount: r.amount, dueDate: r.date })),
      reporting: terms.reporting
        .filter((r) => r.label.trim() && r.date)
        .map((r) => ({ label: r.label.trim(), dueDate: r.date })),
      signatory: letterSettings?.signatory ?? null,
    }
    return renderAwardLetter({
      input,
      settings: terms.useStandardConditions
        ? { template: letterSettings?.template ?? null, conditions, signatory: null }
        : { template: letterSettings?.template ?? null, conditions: [], signatory: null },
      specialCondition: g.conditions
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n'),
    })
  }

  const totalCommitted = candidates.reduce((s, c) => s + (parseFloat(grants[c.id]!.amount) || 0), 0)

  // Validation is per step, and it GATES rather than reports: a schedule that does not
  // add up is fixed on the step that owns it, where the numbers are on screen — not
  // announced two steps later as a line of red text over the letters.
  const completeMilestones = terms.reporting.filter((r) => r.label.trim() && r.date).length

  const termsProblems = useMemo(() => {
    const list: string[] = []
    if (!terms.startDate) list.push('Set the grant start date.')
    if (!terms.firstPaymentDate) list.push('Set the first payment date.')
    if (completeMilestones === 0) list.push('Add at least one reporting date.')
    if (terms.reporting.some((r) => (r.label.trim() ? 1 : 0) + (r.date ? 1 : 0) === 1)) {
      list.push('Every reporting milestone needs both a label and a date.')
    }
    // A reporting date is a date a report is DUE — a past one asks a grantee for
    // something that was already late when the letter was written, and lands on Reports
    // overdue on day one. The picker bars past days; this catches the hidden native
    // input behind it, which is still typeable. (The grant start date is deliberately
    // NOT barred: a board approving in September a grant that began in August is
    // ordinary, and the same goes for the payment dates that follow it.)
    if (terms.reporting.some((r) => r.date && r.date < todayIso())) {
      list.push('A reporting date cannot be in the past.')
    }
    return list
  }, [terms, completeMilestones])

  /**
   * Per grant: what is not yet right about it. Shown against the grant on step 2 and (for
   * a hand-edited split) by the allocation guardrail on step 1, so the disabled Continue
   * always has its reason next to the field that caused it.
   */
  const grantProblems = useMemo(() => {
    const byId = new Map<string, { kind: 'amount' | 'schedule' | 'purpose'; text: string }>()
    for (const c of candidates) {
      const g = grants[c.id]!
      const amount = parseFloat(g.amount) || 0
      // Checked first and alone: with no amount there is nothing for a schedule to add
      // up to, and the field that fixes it is on the next step.
      if (amount <= 0) {
        byId.set(c.id, { kind: 'amount', text: 'Set an amount to award.' })
        continue
      }
      const schedule = scheduleFor(c)
      const allocated = schedule.reduce((s, r) => s + r.amount, 0)
      if (Math.abs(allocated - amount) > 0.005) {
        byId.set(c.id, {
          kind: 'schedule',
          text: `The payment schedule adds up to ${fmtMoney(allocated)}, not ${fmtMoney(amount)} — adjust the split on Terms.`,
        })
        continue
      }
      // A £0 instalment is silently dropped by the server's positive-amount check, so
      // catch it here where it can still be explained and fixed.
      if (schedule.some((r) => r.amount <= 0)) {
        byId.set(c.id, { kind: 'schedule', text: 'Every instalment must be more than £0.' })
        continue
      }
      // The purpose is a paragraph of the letter, not a note: the template says "The
      // grant is made towards the following purpose:" and then prints it. Left empty the
      // grantee is sent a letter with a hole in it, and the conditions that bind to "the
      // agreed purpose" bind to nothing. So it gates, and the card's amber pill is what
      // says so — a second amber message under the same card would only repeat it.
      if (!g.purpose.trim()) {
        byId.set(c.id, { kind: 'purpose', text: 'Write what the grant is for.' })
      }
    }
    return byId
  }, [candidates, grants, terms])

  // A step is gated only by what it can actually fix — the amount and the purpose live
  // on step 2, so neither may be what holds step 1 shut.
  const scheduleBlocked = [...grantProblems.values()].some((p) => p.kind === 'schedule')
  const blocked =
    step === 1
      ? termsProblems.length > 0 || scheduleBlocked
      : termsProblems.length > 0 || grantProblems.size > 0

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    try {
      const response = await createAwards({
        data: {
          terms: {
            startDate: terms.startDate,
            useStandardConditions: terms.useStandardConditions,
            reporting: terms.reporting
              .filter((r) => r.label.trim() && r.date)
              .map((r) => ({ label: r.label.trim(), dueDate: r.date })),
          },
          grants: candidates.map((c) => {
            const g = grants[c.id]!
            const bespoke = g.conditions.map((line) => line.trim()).filter(Boolean)
            return {
              applicationId: c.id,
              amountAwarded: parseFloat(g.amount) || 0,
              purpose: g.purpose.trim() || null,
              // One column, one clause per line — `renderAwardLetter` numbers them
              // continuously with the standard conditions.
              specialCondition: bespoke.length > 0 ? bespoke.join('\n') : null,
              schedule: scheduleFor(c).map((r, i) => ({
                instalment: i + 1,
                amount: r.amount,
                date: r.date,
              })),
            }
          }),
        },
        // Each grant is written in its own batch, so a whole shortlist takes far longer
        // than a single mutation — and this is the screen where being cut off early
        // would be most alarming.
        headers: longerTimeout(120_000),
      })
      onDone(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The awards could not be created')
    } finally {
      setSaving(false)
    }
  }

  const one = candidates.length === 1

  return (
    <Dialog
      open
      size="lg"
      busy={saving}
      onClose={onClose}
      title="Set up award"
      description="Set terms once · Review each grant · Confirm"
      footer={
        <div className="flex flex-col gap-3">
          {/* Amber, and only on the step that owns them: these are things still to do,
              not things gone wrong — the flow opens with the reporting date unset. */}
          {step === 1 && termsProblems.length > 0 && (
            <ul className="space-y-1">
              {termsProblems.map((p) => (
                <li key={p} className="font-display text-label" style={{ color: C.amber }}>
                  {p}
                </li>
              ))}
            </ul>
          )}
          <ErrorNote error={error} />
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              icon={ArrowLeft02Icon}
              onClick={() => (step === 1 ? onClose() : setStep(step - 1))}
              disabled={saving}
            >
              Back
            </Button>
            {step < 3 ? (
              <Button
                icon={ArrowRight02Icon}
                iconPosition="right"
                onClick={() => setStep(step + 1)}
                disabled={blocked}
              >
                Continue
              </Button>
            ) : (
              <Button
                icon={ArrowRight02Icon}
                iconPosition="right"
                onClick={handleConfirm}
                disabled={saving || blocked}
              >
                {saving
                  ? 'Creating…'
                  : `Confirm & send ${one ? 'award letter' : `${candidates.length} award letters`}`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Stepper step={step} />

        {/* ── 1. Terms ── */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <p className="font-display text-body leading-relaxed" style={{ color: C.body }}>
              {one
                ? 'Set the terms for this award. Everything is pre-filled from your standard defaults — adjust anything that differs.'
                : `Set the terms shared by all ${candidates.length} awards. Everything is pre-filled from your standard defaults — adjust anything that differs.`}
            </p>

            <div className="flex flex-wrap gap-4">
              <div className="w-[200px]">
                <FieldLabel>Grant start date</FieldLabel>
                <DateField
                  value={terms.startDate}
                  onChange={setStartDate}
                  aria-label="Grant start date"
                />
                <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
                  When the grant period begins.
                </p>
              </div>
              <div className="w-[200px]">
                <FieldLabel>First payment</FieldLabel>
                <DateField
                  value={terms.firstPaymentDate}
                  onChange={(v) => setTerms((t) => ({ ...t, firstPaymentDate: v }))}
                  aria-label="First payment date"
                />
                <p className="mt-1 font-display text-label" style={{ color: C.faint }}>
                  The date of the first payment.
                </p>
              </div>
            </div>

            <div>
              <FieldLabel>Payment structure</FieldLabel>
              <Segmented
                ariaLabel="Payment structure"
                value={terms.structure}
                onChange={setStructure}
                options={[
                  { value: 1 as const, label: '1 payment' },
                  { value: 2 as const, label: '2 instalments' },
                  { value: 3 as const, label: '3 instalments' },
                  { value: 'custom' as const, label: 'Custom' },
                ]}
              />
            </div>

            {terms.structure !== 'custom' && terms.structure > 1 && (
              <div>
                <FieldLabel>Frequency</FieldLabel>
                <Segmented
                  ariaLabel="Payment frequency"
                  value={terms.cadence}
                  onChange={(v) => setTerms((t) => ({ ...t, cadence: v }))}
                  options={CADENCES.map((c) => ({ value: c.key, label: c.label }))}
                />
              </div>
            )}

            {custom ? (
              <CustomSchedules
                candidates={candidates}
                grants={grants}
                setGrant={setGrant}
                splitEvenly={splitEvenly}
              />
            ) : (
              <SchedulePreview
                candidates={candidates}
                scheduleFor={scheduleFor}
                total={totalCommitted}
              />
            )}

            <div>
              <FieldLabel>Reporting</FieldLabel>
              <p className="mb-2 font-display text-body" style={{ color: C.sub }}>
                The dates you expect a report on. They appear on every letter, and in Reports once
                the grants are live. At least one is required.
              </p>
              <div className="flex flex-col gap-2">
                {terms.reporting.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="Milestone label"
                      value={r.label}
                      onChange={(e) =>
                        setTerms((t) => ({
                          ...t,
                          reporting: t.reporting.map((row, idx) =>
                            idx === i ? { ...row, label: e.target.value } : row,
                          ),
                        }))
                      }
                      aria-label={`Reporting milestone ${i + 1} label`}
                    />
                    <div className="w-[180px] shrink-0">
                      <DateField
                        value={r.date}
                        min={todayIso()}
                        onChange={(v) =>
                          setTerms((t) => ({
                            ...t,
                            reporting: t.reporting.map((row, idx) =>
                              idx === i ? { ...row, date: v } : row,
                            ),
                          }))
                        }
                        aria-label={`Reporting milestone ${i + 1} date`}
                      />
                    </div>
                    {terms.reporting.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setTerms((t) => ({
                            ...t,
                            reporting: t.reporting.filter((_, idx) => idx !== i),
                          }))
                        }
                        aria-label={`Remove reporting milestone ${i + 1}`}
                        className="flex size-8 shrink-0 items-center justify-center rounded-chip hover:bg-danger/10"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={16} color={C.danger} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="text"
                icon={PlusSignIcon}
                className="mt-2"
                onClick={() =>
                  setTerms((t) => ({ ...t, reporting: [...t.reporting, { label: '', date: '' }] }))
                }
              >
                Add new reporting milestone
              </Button>
            </div>

            <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
              <label
                aria-label="Attach your standard conditions"
                className="flex cursor-pointer items-center gap-3 px-3.5 py-3"
              >
                <input
                  type="checkbox"
                  checked={terms.useStandardConditions}
                  onChange={(e) =>
                    setTerms((t) => ({ ...t, useStandardConditions: e.target.checked }))
                  }
                  className="size-4 accent-brand"
                />
                <span className="flex-1">
                  <span
                    className="block font-display text-body font-medium"
                    style={{ color: C.ink }}
                  >
                    Attach your standard conditions
                  </span>
                  <span className="block font-display text-label" style={{ color: C.sub }}>
                    {conditions.length} clause{conditions.length === 1 ? '' : 's'} · they appear on
                    every award letter
                  </span>
                </span>
              </label>
              {terms.useStandardConditions && (
                <div
                  className="border-t px-3.5 py-3"
                  style={{ borderColor: C.line, backgroundColor: C.wash }}
                >
                  <ol
                    className="list-decimal space-y-1.5 pl-4 font-display text-label leading-relaxed"
                    style={{ color: C.body }}
                  >
                    {conditions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ol>
                  <Link
                    to="/settings/award-letter"
                    className="mt-2.5 inline-block font-display text-label font-medium hover:underline"
                    style={{ color: C.brand }}
                  >
                    Edit your standard conditions in Settings →
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 2. Grant details ── */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <p className="font-display text-body leading-relaxed" style={{ color: C.body }}>
              Review each award. The programme comes from the application and the amount from what
              was asked for — change either figure that should differ. Grants with no purpose are
              flagged.
            </p>

            {candidates.map((c) => {
              const g = grants[c.id]!
              const duration = durationLabel(c.grantDurationYears)
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-3 rounded-card border p-4"
                  style={{ borderColor: C.line }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span
                          className="font-display text-title font-medium"
                          style={{ color: C.ink }}
                        >
                          {c.organisationName}
                        </span>
                        <span className="font-display text-label" style={{ color: C.sub }}>
                          {[c.deliveryArea, fmtRef(c.externalApplicationId)]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      <div className="mt-0.5 font-display text-label" style={{ color: C.sub }}>
                        {[c.programmeName, duration].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {/* The comps show the amount as a fixed figure. It stays editable:
                          awarding less than was asked for is ordinary, and the amount is
                          what every instalment and the letter's total derive from. */}
                      <div className="flex items-baseline gap-1">
                        <span
                          className="font-display text-heading font-medium"
                          style={{ color: C.ink }}
                        >
                          £
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={g.amount}
                          onChange={(e) => setGrant(c.id, { amount: e.target.value })}
                          aria-label={`Amount awarded to ${c.organisationName}`}
                          className="w-[132px] rounded-chip bg-transparent px-1 text-right font-display text-heading font-medium tabular-nums hover:bg-grey-50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-brand/20"
                          style={{ color: C.ink }}
                        />
                      </div>
                      {g.purpose.trim() ? (
                        <StatePill tone="ready">Ready</StatePill>
                      ) : (
                        <StatePill tone="todo">Purpose needed</StatePill>
                      )}
                    </div>
                  </div>

                  <Textarea
                    value={g.purpose}
                    onChange={(e) => setGrant(c.id, { purpose: e.target.value })}
                    placeholder="Write the grant award purpose (appears on the award letter)…"
                    aria-label={`Grant purpose for ${c.organisationName}`}
                    rows={4}
                    style={{ backgroundColor: g.purpose ? undefined : C.wash }}
                  />

                  {g.conditions.map((value, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={value}
                        onChange={(e) =>
                          setGrant(c.id, {
                            conditions: g.conditions.map((v, idx) =>
                              idx === i ? e.target.value : v,
                            ),
                          })
                        }
                        placeholder="Grant-specific condition (optional) — e.g. restricted to capital works"
                        aria-label={`Condition ${i + 1} for ${c.organisationName}`}
                        style={{ backgroundColor: value ? undefined : C.wash }}
                      />
                      {g.conditions.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setGrant(c.id, {
                              conditions: g.conditions.filter((_, idx) => idx !== i),
                            })
                          }
                          aria-label={`Remove condition ${i + 1} for ${c.organisationName}`}
                          className="flex size-8 shrink-0 items-center justify-center rounded-chip hover:bg-danger/10"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={16} color={C.danger} />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Under the condition inputs, because that is the field it adds
                      another of — not under the card, where it would read as adding a
                      condition to the batch. */}
                  <Button
                    variant="text"
                    icon={PlusSignIcon}
                    className="self-start"
                    onClick={() => setGrant(c.id, { conditions: [...g.conditions, ''] })}
                  >
                    Add new condition
                  </Button>

                  {/* The amount is edited here and the split is set on Terms, so this is
                      where a hand-edited schedule stops matching its grant. A missing
                      purpose is left to the pill beside the amount — the empty box it
                      refers to is directly above. */}
                  {grantProblems.get(c.id)?.kind !== 'purpose' && grantProblems.has(c.id) && (
                    <p
                      className="rounded-chip px-3 py-2 font-display text-label"
                      style={{ backgroundColor: C.amberWash, color: C.amber }}
                    >
                      {grantProblems.get(c.id)!.text}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── 3. Award letters ── */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-card border" style={{ borderColor: C.line }}>
              {[
                {
                  l: one ? 'Award' : 'Awards in this batch',
                  v: one ? candidates[0]!.organisationName : String(candidates.length),
                },
                { l: 'Total committed', v: fmtMoney(totalCommitted), emph: true },
                { l: 'Grant start date', v: fmtDate(terms.startDate) },
                { l: 'First payment', v: fmtDate(terms.firstPaymentDate) },
                {
                  l: 'Payment structure',
                  v: custom
                    ? 'Custom per grant'
                    : terms.structure === 1
                      ? 'Single payment'
                      : `${terms.structure} instalments`,
                },
                {
                  l: 'Reporting milestones',
                  v: `${terms.reporting.filter((r) => r.label.trim() && r.date).length} per grant`,
                },
                {
                  l: 'Conditions',
                  v: terms.useStandardConditions
                    ? `${conditions.length} standard`
                    : 'No standard conditions',
                },
              ].map((row, i, all) => (
                <div
                  key={row.l}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{
                    borderBottom: i < all.length - 1 ? `1px solid ${C.line}` : undefined,
                  }}
                >
                  <span className="font-display text-body" style={{ color: C.sub }}>
                    {row.l}
                  </span>
                  <span
                    className="font-display text-body font-medium"
                    style={{ color: row.emph ? C.brand : C.ink }}
                  >
                    {row.v}
                  </span>
                </div>
              ))}
            </div>

            <div>
              <FieldLabel>Award letter</FieldLabel>
              <div className="rounded-card border" style={{ borderColor: C.line }}>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-display text-body font-medium" style={{ color: C.ink }}>
                      {letterSettings?.template ? 'Your award letter' : 'Standard award letter'}
                    </div>
                    <div className="font-display text-label" style={{ color: C.sub }}>
                      {one
                        ? 'One letter will be sent to the grantee on confirm'
                        : `${candidates.length} letters will be sent to grantees on confirm`}
                    </div>
                  </div>
                  <Button
                    variant="text"
                    icon={letterOpen ? ArrowUp01Icon : ArrowDown01Icon}
                    iconPosition="right"
                    onClick={() => setLetterOpen(!letterOpen)}
                  >
                    {letterOpen ? 'Hide preview' : 'Preview'}
                  </Button>
                </div>

                {letterOpen && (
                  <LetterCarousel
                    candidates={candidates}
                    index={Math.min(letterIndex, candidates.length - 1)}
                    onIndex={setLetterIndex}
                    letterFor={letterFor}
                  />
                )}
              </div>
              <p className="mt-2 font-display text-label" style={{ color: C.sub }}>
                Sent from{' '}
                <strong style={{ color: C.body }}>
                  {letterSettings?.senderName ||
                    letterSettings?.foundationName ||
                    'your foundation'}
                </strong>
                {letterSettings?.replyTo ? (
                  <>
                    , with replies going to{' '}
                    <strong style={{ color: C.body }}>{letterSettings.replyTo}</strong>.
                  </>
                ) : (
                  <>
                    . No reply-to address is set, so replies come back to Custodian —{' '}
                    <Link
                      to="/settings/award-letter"
                      className="font-medium hover:underline"
                      style={{ color: C.brand }}
                    >
                      set one in Settings
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}

// ─── Step 1 sub-views ───────────────────────────────────────────────────────────

/**
 * What the shared terms produce. For one grant that is its own schedule; for a batch it
 * is the batch total per instalment — the figure an admin is actually settling at this
 * point, with each grant's own split shown on the letters.
 */
function SchedulePreview({
  candidates,
  scheduleFor,
  total,
}: {
  candidates: AwardCandidate[]
  scheduleFor: (c: AwardCandidate) => Array<{ amount: number; date: string | null }>
  total: number
}) {
  const schedules = candidates.map(scheduleFor)
  const rowCount = Math.max(0, ...schedules.map((s) => s.length))
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    amount: schedules.reduce((s, sched) => s + (sched[i]?.amount ?? 0), 0),
    date: schedules.find((sched) => sched[i]?.date)?.[i]?.date ?? null,
  }))

  return (
    <div className="rounded-card p-4" style={{ backgroundColor: C.wash }}>
      <div className="mb-2 font-display text-body font-medium" style={{ color: C.ink }}>
        Schedule
      </div>
      <dl className="flex flex-col gap-1.5">
        {rows.map((r, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <dt className="font-display text-body" style={{ color: C.sub }}>
              Instalment {i + 1}
            </dt>
            <dd className="flex shrink-0 items-baseline gap-3 font-display text-body">
              <span style={{ color: C.sub }}>{r.date ? fmtDate(r.date) : 'Date TBC'}</span>
              <span className="w-24 text-right font-medium tabular-nums" style={{ color: C.ink }}>
                {fmtMoney(r.amount)}
              </span>
            </dd>
          </div>
        ))}
        <div
          className="mt-1.5 flex items-baseline justify-between gap-3 border-t pt-2"
          style={{ borderColor: C.line }}
        >
          <dt className="font-display text-body" style={{ color: C.sub }}>
            Total
          </dt>
          <dd
            className="font-display text-body font-medium tabular-nums"
            style={{ color: C.brand }}
          >
            {fmtMoney(total)}
          </dd>
        </div>
      </dl>
      {candidates.length > 1 && (
        <p className="mt-2 font-display text-label" style={{ color: C.faint }}>
          Combined across {candidates.length} grants. Each grant’s own split is on its letter.
        </p>
      )}
    </div>
  )
}

/** The hand-edited split, per grant — what `Custom` switches the structure over to. */
function CustomSchedules({
  candidates,
  grants,
  setGrant,
  splitEvenly,
}: {
  candidates: AwardCandidate[]
  grants: Record<string, GrantState>
  setGrant: (id: string, patch: Partial<GrantState>) => void
  splitEvenly: (c: AwardCandidate) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {candidates.map((c) => {
        const g = grants[c.id]!
        const amount = parseFloat(g.amount) || 0
        const allocated = g.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
        const remaining = amount - allocated
        const reconciled = Math.abs(remaining) < 0.005

        return (
          <div key={c.id} className="rounded-card border p-3.5" style={{ borderColor: C.line }}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span
                className="truncate font-display text-body font-medium"
                style={{ color: C.ink }}
              >
                {c.organisationName}
              </span>
              <span className="shrink-0 font-display text-label" style={{ color: C.sub }}>
                {fmtMoney(amount)}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {g.rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-4 shrink-0 font-display text-label" style={{ color: C.faint }}>
                    {i + 1}
                  </span>
                  <div className="w-[130px] shrink-0">
                    <Input
                      type="number"
                      min="0"
                      value={r.amount}
                      onChange={(e) =>
                        setGrant(c.id, {
                          rows: g.rows.map((row, idx) =>
                            idx === i ? { ...row, amount: e.target.value } : row,
                          ),
                        })
                      }
                      aria-label={`Instalment ${i + 1} amount for ${c.organisationName}`}
                    />
                  </div>
                  <DateField
                    value={r.date}
                    onChange={(v) =>
                      setGrant(c.id, {
                        rows: g.rows.map((row, idx) => (idx === i ? { ...row, date: v } : row)),
                      })
                    }
                    aria-label={`Instalment ${i + 1} date for ${c.organisationName}`}
                  />
                  {g.rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setGrant(c.id, { rows: g.rows.filter((_, idx) => idx !== i) })}
                      aria-label={`Remove instalment ${i + 1} for ${c.organisationName}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-chip hover:bg-danger/10"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={16} color={C.danger} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap gap-4">
              <Button
                variant="text"
                icon={PlusSignIcon}
                onClick={() => setGrant(c.id, { rows: [...g.rows, { amount: '0', date: '' }] })}
              >
                Add instalment
              </Button>
              {/* Off when the rows already carry that split — a button that would
                  change nothing invites a click to find out. */}
              <Button
                variant="text"
                style={{ color: C.sub }}
                onClick={() => splitEvenly(c)}
                disabled={isEvenSplit(g)}
              >
                Split evenly
              </Button>
            </div>

            {/* The schedule must sum to the award, and that is far easier to fix while
                looking at it than to decode from a message on the last step. */}
            <div
              className="mt-2 flex items-center justify-between gap-3 rounded-chip px-3 py-2 font-display text-label"
              style={{
                backgroundColor: reconciled ? C.brandBg : C.amberWash,
                color: reconciled ? C.brand : C.amber,
              }}
            >
              <span>
                {reconciled
                  ? 'Fully allocated'
                  : remaining > 0
                    ? `${fmtMoney(remaining)} left to allocate`
                    : `${fmtMoney(-remaining)} over-allocated`}
              </span>
              <span className="font-medium tabular-nums">
                {fmtMoney(allocated)} / {fmtMoney(amount)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Step 3 sub-view ────────────────────────────────────────────────────────────

/**
 * One letter at a time, paged with ‹ ›.
 *
 * Stacked, a batch of eight letters is several thousand words of near-identical text in
 * one scroll — which is not a preview anybody reads. Paging keeps each letter whole and
 * makes it obvious how many there are.
 */
function LetterCarousel({
  candidates,
  index,
  onIndex,
  letterFor,
}: {
  candidates: AwardCandidate[]
  index: number
  onIndex: (i: number) => void
  letterFor: (c: AwardCandidate) => { subject: string; bodyText: string }
}) {
  const c = candidates[index]!
  const letter = letterFor(c)

  return (
    <div className="border-t" style={{ borderColor: C.line }}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5"
        style={{ backgroundColor: C.wash }}
      >
        {/* No state pill here: every field a letter can be missing is now gated on the
            step that owns it, so a letter you can look at is a letter that is ready, and
            a pill that can only ever read "Ready" is noise. */}
        <span className="truncate font-display text-body font-medium" style={{ color: C.ink }}>
          {c.organisationName}
        </span>
        {candidates.length > 1 && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              icon={ArrowLeft01Icon}
              aria-label="Previous letter"
              onClick={() => onIndex(index - 1)}
              disabled={index === 0}
            />
            <span className="font-display text-label tabular-nums" style={{ color: C.sub }}>
              {index + 1} of {candidates.length}
            </span>
            <Button
              variant="secondary"
              size="xs"
              icon={ArrowRight01Icon}
              aria-label="Next letter"
              onClick={() => onIndex(index + 1)}
              disabled={index === candidates.length - 1}
            />
          </div>
        )}
      </div>
      <div className="px-4 py-4">
        <div className="mb-2 font-display text-label" style={{ color: C.faint }}>
          Subject: <span style={{ color: C.body }}>{letter.subject}</span>
        </div>
        <AwardLetterPreview bodyText={letter.bodyText} />
      </div>
    </div>
  )
}
