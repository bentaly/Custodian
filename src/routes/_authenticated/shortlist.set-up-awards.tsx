import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  createAwards,
  getAwardLetterSettings,
  listAwardCandidates,
} from '../../server/fns/awardSetup'
import { AwardLetterPreview } from '../../components/AwardLetterPreview'
import { Breadcrumb, Button, EmptyState } from '../../components/ui'
import {
  DEFAULT_GRANT_CONDITIONS,
  renderAwardLetter,
  type AwardLetterInput,
} from '../../lib/awardLetter'
import { CADENCES, buildSchedule, cadenceMonths, type CadenceKey } from '../../lib/awardSchedule'
import { fmtDate, fmtMoney } from '../../lib/format'
import { todayIso } from '../../lib/schedule'
import { longerTimeout } from '../../lib/requestTimeout'

export const Route = createFileRoute('/_authenticated/shortlist/set-up-awards')({
  validateSearch: (search: Record<string, unknown>) => ({
    roundId:
      typeof search.roundId === 'string' ? search.roundId : (undefined as string | undefined),
  }),
  // Awarding is an admin act — trustees decide, admins commit. Guard the route as well
  // as the server fn so a trustee following a link gets sent back rather than shown a
  // form every button on which will be refused.
  beforeLoad: ({ context, search }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/shortlist', search: { roundId: search.roundId } })
  },
  loaderDeps: ({ search }) => ({ roundId: search.roundId }),
  loader: async ({ deps }) => {
    const [candidates, letterSettings] = await Promise.all([
      listAwardCandidates({ data: { roundId: deps.roundId } }),
      getAwardLetterSettings(),
    ])
    return { candidates, letterSettings }
  },
  component: SetUpAwards,
})

type Candidate = Awaited<ReturnType<typeof listAwardCandidates>>[number]

type GrantState = {
  selected: boolean
  amount: string
  purpose: string
  specialCondition: string
  /** Once the schedule is hand-edited we stop deriving it from the shared terms. */
  custom: boolean
  rows: Array<{ amount: string; date: string }>
}

type Terms = {
  startDate: string
  /**
   * When the money actually starts moving. Seeded from — and kept in step with — the
   * start date until someone edits it, because a grant that begins on 1 September and
   * pays a month in arrears is ordinary, and folding the two together made that
   * impossible to express.
   */
  firstPaymentDate: string
  instalments: number
  cadence: CadenceKey
  useStandardConditions: boolean
  reporting: Array<{ label: string; date: string }>
}

// Amount before schedule. The schedule is a split OF the amount, so choosing the split
// while the amount is still a step away meant the numbers underneath it were guesses —
// which is what pushed the custom editor onto a later screen. With the amount settled
// in step 1, the whole payment structure (shared controls + any hand-edited split) fits
// where it belongs: next to the terms it derives from.
const STEPS = [
  { n: 1, label: 'Grants' },
  { n: 2, label: 'Terms' },
  { n: 3, label: 'Letters' },
] as const

const LAST_STEP = STEPS.length

const inputClass =
  'rounded-md border border-[#E3E0D6] px-2.5 py-1.5 text-[12.5px] text-[#3C453F] focus:outline-hidden focus:ring-2 focus:ring-[#1F7A5C]/30'

function Stepper({ step, onGoto }: { step: number; onGoto: (n: number) => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2">
      {STEPS.map((s, i) => {
        const done = step > s.n
        const active = step === s.n
        return (
          <div key={s.n} className="flex items-center gap-2">
            <button
              onClick={() => onGoto(s.n)}
              className="flex items-center gap-2"
              disabled={s.n > step}
            >
              <span
                className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-semibold ${
                  active
                    ? 'bg-[#1F7A5C] text-white'
                    : done
                      ? 'bg-[#DFF3EA] text-[#1F7A5C]'
                      : 'bg-[#F1EFE9] text-[#B4B0A4]'
                }`}
              >
                {done ? '✓' : s.n}
              </span>
              <span
                className={`text-xs ${active ? 'font-medium text-[#202823]' : 'text-[#9CA49E]'}`}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && <span className="mx-1.5 h-px w-6 bg-[#ECEAE3]" />}
          </div>
        )
      })}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.05em] text-[#9CA49E]">
      {children}
    </div>
  )
}

function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-3.5 py-1.5 text-[12.5px] transition-colors ${
        on
          ? 'border-[#1F7A5C] bg-[#DFF3EA] font-semibold text-[#1F7A5C]'
          : 'border-[#E3E0D6] bg-white text-[#5A6660] hover:bg-[#FAF9F6]'
      }`}
    >
      {children}
    </button>
  )
}

function SetUpAwards() {
  const navigate = useNavigate()
  const { roundId } = Route.useSearch()
  const { candidates, letterSettings } = Route.useLoaderData()

  const [step, setStep] = useState(1)
  const [terms, setTerms] = useState<Terms>(() => ({
    startDate: todayIso(),
    firstPaymentDate: todayIso(),
    instalments: 1,
    cadence: 'yearly',
    useStandardConditions: true,
    reporting: [],
  }))
  const [grants, setGrants] = useState<Record<string, GrantState>>(() =>
    Object.fromEntries(
      candidates.map((c) => [
        c.id,
        {
          selected: true,
          amount: String(c.amountRequested),
          // Pre-filled from the application's grant purpose, then edited freely: what
          // ends up here is what the grantee's letter says, so the admin gets the last
          // word. The edit stays on the award — the application keeps the AI's wording.
          purpose: c.grantPurpose ?? '',
          specialCondition: '',
          custom: false,
          rows: [],
        },
      ]),
    ),
  )
  const [openSchedule, setOpenSchedule] = useState<string | null>(null)
  const [openLetter, setOpenLetter] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof createAwards>> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const conditions = letterSettings?.conditions ?? DEFAULT_GRANT_CONDITIONS
  const selected = candidates.filter((c) => grants[c.id]?.selected)

  function setGrant(id: string, patch: Partial<GrantState>) {
    setGrants((g) => ({ ...g, [id]: { ...g[id]!, ...patch } }))
  }

  /** Moving the start date drags the first payment with it, but only while the two are
   *  still in step — once someone has set a payment date of their own, leave it alone. */
  function setStartDate(value: string) {
    setTerms((t) => ({
      ...t,
      startDate: value,
      firstPaymentDate: t.firstPaymentDate === t.startDate ? value : t.firstPaymentDate,
    }))
  }

  /** The schedule for one grant: derived from the shared terms unless hand-edited. */
  function scheduleFor(c: Candidate): Array<{ amount: number; date: string | null }> {
    const g = grants[c.id]!
    if (g.custom) {
      return g.rows.map((r) => ({ amount: parseFloat(r.amount) || 0, date: r.date || null }))
    }
    return buildSchedule(
      parseFloat(g.amount) || 0,
      terms.instalments,
      terms.firstPaymentDate || null,
      cadenceMonths(terms.cadence),
    )
  }

  /** Hand the derived rows over to the user, pre-filled, so a custom split starts from
   *  what they were already looking at rather than from an empty table. */
  function enterCustom(c: Candidate) {
    const rows = scheduleFor(c).map((r) => ({ amount: String(r.amount), date: r.date ?? '' }))
    setGrant(c.id, { custom: true, rows })
    setOpenSchedule(c.id)
  }

  /** Re-split the awarded total evenly across however many rows the user has made,
   *  keeping their dates. The remainder goes on the last instalment so the rows always
   *  sum to the award exactly. */
  function splitEvenly(c: Candidate) {
    const g = grants[c.id]!
    const total = parseFloat(g.amount) || 0
    const n = g.rows.length
    if (n === 0) return
    const base = Math.floor(total / n)
    setGrant(c.id, {
      rows: g.rows.map((r, i) => ({
        ...r,
        amount: String(i === n - 1 ? total - base * (n - 1) : base),
      })),
    })
  }

  function letterFor(c: Candidate) {
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
      specialCondition: g.specialCondition || null,
    })
  }

  // Validation, computed once so the footer and the step bodies agree.
  const problems = useMemo(() => {
    const list: string[] = []
    if (selected.length === 0) list.push('Select at least one grant to set up.')
    if (!terms.startDate) list.push('Set a start date.')
    if (terms.reporting.some((r) => (r.label.trim() ? 1 : 0) + (r.date ? 1 : 0) === 1)) {
      list.push('Every reporting milestone needs both a label and a date.')
    }
    for (const c of selected) {
      const g = grants[c.id]!
      const amount = parseFloat(g.amount) || 0
      if (amount <= 0) list.push(`${c.organisationName}: set an amount to award.`)
      const schedule = scheduleFor(c)
      const allocated = schedule.reduce((s, r) => s + r.amount, 0)
      if (amount > 0 && Math.abs(allocated - amount) > 0.005) {
        list.push(
          `${c.organisationName}: the payment schedule adds up to ${fmtMoney(allocated)}, not ${fmtMoney(amount)}.`,
        )
      }
      // A £0 instalment is silently dropped by the server's positive-amount check, so
      // catch it here where it can still be explained and fixed.
      if (schedule.some((r) => r.amount <= 0)) {
        list.push(`${c.organisationName}: every instalment must be more than £0.`)
      }
    }
    return list
  }, [selected, grants, terms])

  const missingPurpose = selected.filter((c) => !grants[c.id]!.purpose.trim())
  const totalCommitted = selected.reduce((s, c) => s + (parseFloat(grants[c.id]!.amount) || 0), 0)

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
          grants: selected.map((c) => {
            const g = grants[c.id]!
            return {
              applicationId: c.id,
              amountAwarded: parseFloat(g.amount) || 0,
              purpose: g.purpose.trim() || null,
              specialCondition: g.specialCondition.trim() || null,
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
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The awards could not be created')
    } finally {
      setSaving(false)
    }
  }

  // ── Done ──
  if (result) {
    const failures = result.results.filter((r) => r.error)
    return (
      <div className="max-w-3xl">
        <Breadcrumb
          items={[
            { label: 'Shortlist', to: '/shortlist', search: { roundId } },
            { label: 'Set up awards' },
          ]}
        />
        <h1 className="mt-3 font-display text-[28px] text-[#202823]">
          {result.created === 1 ? 'Award created' : `${result.created} awards created`}
        </h1>
        <p className="mt-1 text-sm text-[#5A6660]">
          {fmtMoney(result.totalCommitted)} committed. Award letters are on their way to the
          grantees — each one is saved against its award, where you can read it and resend it.
        </p>

        {failures.length > 0 && (
          <div className="mt-5 rounded-xl border border-[#F0D3DC] bg-[#FBEEF2] p-4">
            <div className="text-[12.5px] font-bold text-[#A34D68]">
              {failures.length} could not be awarded
            </div>
            <ul className="mt-2 space-y-1">
              {failures.map((f) => (
                <li key={f.applicationId} className="text-[12px] text-[#A34D68]">
                  <strong>{f.organisationName}</strong> — {f.error}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11.5px] text-[#A34D68]">
              Everything else went through. These are unchanged and still on the shortlist.
            </p>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Link
            to="/awards"
            search={{ roundId: undefined, programmeId: undefined, tag: undefined, q: undefined }}
            className="rounded-[11px] bg-[#1F7A5C] px-4 py-2.5 text-[13px] font-bold text-white hover:bg-[#17563F]"
          >
            View awards →
          </Link>
          <Link
            to="/shortlist"
            search={{ roundId }}
            className="rounded-[11px] border border-[#E3E0D6] px-4 py-2.5 text-[13px] font-medium text-[#5A6660] hover:bg-[#FAF9F6]"
          >
            Back to shortlist
          </Link>
        </div>
      </div>
    )
  }

  // ── Nothing to do ──
  if (candidates.length === 0) {
    return (
      <div className="max-w-3xl">
        <Breadcrumb
          items={[
            { label: 'Shortlist', to: '/shortlist', search: { roundId } },
            { label: 'Set up awards' },
          ]}
        />
        <EmptyState className="mt-4">
          <p className="text-sm font-medium text-gray-500">Nothing is ready to award</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-gray-400">
            An application appears here once a majority of trustees have voted in favour of it on
            the Shortlist. Nothing in this round has cleared that bar yet.
          </p>
          <Link
            to="/shortlist"
            search={{ roundId }}
            className="mt-4 inline-block rounded-sm border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Back to shortlist
          </Link>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <Breadcrumb
        items={[
          { label: 'Shortlist', to: '/shortlist', search: { roundId } },
          { label: 'Set up awards' },
        ]}
      />
      <h1 className="mt-3 font-display text-[28px] text-[#202823]">Set up awards</h1>
      <p className="mb-6 mt-1 text-sm text-[#5A6660]">
        Turn board-approved applications into live grants: settle the amounts, set the terms and
        payment schedule, then issue the award letters.
      </p>

      <Stepper step={step} onGoto={setStep} />

      {/* ── 1. Grants: what each organisation gets, and what for ── */}
      {step === 1 && (
        <div className="space-y-3">
          <p className="text-[12.5px] text-[#5A6660]">
            {candidates.length === 1
              ? 'One application has the trustee majority it needs.'
              : `${candidates.length} applications have the trustee majority they need.`}{' '}
            Set what each one is awarded and what it is for — the terms and payment schedule come
            next, and are shared by everything you select.
          </p>

          {candidates.map((c) => {
            const g = grants[c.id]!
            return (
              <div
                key={c.id}
                className={`rounded-xl border bg-white transition-colors ${
                  g.selected ? 'border-[#1F7A5C]' : 'border-[#ECEAE3]'
                }`}
              >
                <div className="flex items-start gap-3 px-4 py-3">
                  <button
                    onClick={() => setGrant(c.id, { selected: !g.selected })}
                    aria-pressed={g.selected}
                    aria-label={`${g.selected ? 'Exclude' : 'Include'} ${c.organisationName}`}
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] text-white ${
                      g.selected ? 'border-[#1F7A5C] bg-[#1F7A5C]' : 'border-[#D6D2C6] bg-white'
                    }`}
                  >
                    {g.selected ? '✓' : ''}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-[#17211D]">
                      {c.organisationName}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-[#9CA49E]">
                      {[c.programmeName, c.roundName, c.deliveryArea, c.externalApplicationId]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="mt-0.5 text-[10.5px] text-[#9CA49E]">
                      {c.yesVotes} of {c.trusteeCount} trustees in favour
                    </div>
                    {g.selected && !c.applicantEmail && (
                      <div className="mt-1 text-[11px] font-medium text-[#8A6A1F]">
                        No contact email on this application — the letter will be saved but not
                        sent.
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-[#9CA49E]">
                      Requested {fmtMoney(c.amountRequested)}
                    </div>
                    {g.selected ? (
                      <div className="relative">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-[#9CA49E]">
                          £
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={g.amount}
                          onChange={(e) => setGrant(c.id, { amount: e.target.value })}
                          aria-label={`Amount awarded to ${c.organisationName}`}
                          className={`${inputClass} w-32 pl-6 text-right font-semibold`}
                        />
                      </div>
                    ) : (
                      <div className="text-[12px] text-[#B4B0A4]">Not being awarded</div>
                    )}
                  </div>
                </div>

                {g.selected && (
                  <div className="border-t border-[#F1EFE9] px-4 py-3">
                    <textarea
                      value={g.purpose}
                      onChange={(e) => setGrant(c.id, { purpose: e.target.value })}
                      placeholder="Grant purpose — what this grant is for, as it should read on the letter…"
                      aria-label={`Grant purpose for ${c.organisationName}`}
                      className={`${inputClass} mb-2 min-h-[52px] w-full resize-y leading-relaxed`}
                    />
                    <input
                      value={g.specialCondition}
                      onChange={(e) => setGrant(c.id, { specialCondition: e.target.value })}
                      placeholder="Condition specific to this grant (optional) — e.g. restricted to capital works"
                      aria-label={`Special condition for ${c.organisationName}`}
                      className={`${inputClass} w-full`}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── 2. Terms: shared dates and conditions, and the payment schedule ── */}
      {step === 2 && (
        <div className="space-y-5">
          <p className="text-[12.5px] text-[#5A6660]">
            {selected.length === 1
              ? 'Set the terms for this award.'
              : `Set the terms shared by all ${selected.length} awards. Any schedule you hand-edit stays with its own grant.`}
          </p>

          <div className="flex flex-wrap gap-5">
            <div>
              <FieldLabel>Grant start date</FieldLabel>
              <input
                type="date"
                value={terms.startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Grant start date"
                className={inputClass}
              />
              <p className="mt-1 max-w-[15rem] text-[11px] text-[#9CA49E]">
                When the grant period begins. It appears on the award letter.
              </p>
            </div>
            <div>
              <FieldLabel>First payment</FieldLabel>
              <input
                type="date"
                value={terms.firstPaymentDate}
                onChange={(e) => setTerms((t) => ({ ...t, firstPaymentDate: e.target.value }))}
                aria-label="First payment date"
                className={inputClass}
              />
              <p className="mt-1 max-w-[15rem] text-[11px] text-[#9CA49E]">
                {terms.firstPaymentDate === terms.startDate
                  ? 'Follows the start date. Change it to pay later.'
                  : 'Set apart from the start date.'}
              </p>
            </div>
          </div>

          <div>
            <FieldLabel>Payment structure</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((n) => (
                <Choice
                  key={n}
                  on={terms.instalments === n}
                  onClick={() => setTerms((t) => ({ ...t, instalments: n }))}
                >
                  {n === 1 ? '1 payment' : `${n} instalments`}
                </Choice>
              ))}
            </div>
          </div>

          {terms.instalments > 1 && (
            <div>
              <FieldLabel>Frequency</FieldLabel>
              <div className="flex flex-wrap gap-2">
                {CADENCES.map((c) => (
                  <Choice
                    key={c.key}
                    on={terms.cadence === c.key}
                    onClick={() => setTerms((t) => ({ ...t, cadence: c.key }))}
                  >
                    {c.label}
                  </Choice>
                ))}
              </div>
            </div>
          )}

          {/* The schedule the controls above produce, per grant — shown here rather than
              a step later so the structure and its consequence are on one screen, and a
              custom split is one click from the controls it replaces. */}
          <div>
            <FieldLabel>
              {selected.length === 1 ? 'Payment schedule' : 'Payment schedules'}
            </FieldLabel>
            <div className="space-y-2">
              {selected.map((c) => {
                const g = grants[c.id]!
                const schedule = scheduleFor(c)
                const amount = parseFloat(g.amount) || 0
                const allocated = schedule.reduce((s, r) => s + r.amount, 0)
                const remaining = amount - allocated
                const reconciled = Math.abs(remaining) < 0.005
                const allPositive = schedule.length > 0 && schedule.every((r) => r.amount > 0)
                // One grant is the old single-award flow — never make the user open it.
                const expanded = selected.length === 1 || openSchedule === c.id || g.custom

                return (
                  <div key={c.id} className="rounded-xl border border-[#ECEAE3] bg-white">
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <button
                        onClick={() => setOpenSchedule(expanded && !g.custom ? null : c.id)}
                        disabled={selected.length === 1}
                        className="min-w-0 flex-1 text-left disabled:cursor-default"
                      >
                        <span className="block truncate text-[12.5px] font-medium text-[#202823]">
                          {c.organisationName}
                        </span>
                        <span className="block truncate text-[11px] text-[#9CA49E]">
                          {fmtMoney(amount)} ·{' '}
                          {schedule.length === 1
                            ? 'single payment'
                            : `${schedule.length} instalments`}
                          {schedule[0]?.date ? ` from ${fmtDate(schedule[0].date)}` : ''}
                          {g.custom ? ' · custom' : ''}
                        </span>
                      </button>
                      {g.custom ? (
                        <button
                          onClick={() => setGrant(c.id, { custom: false, rows: [] })}
                          className="shrink-0 text-[11.5px] font-medium text-[#9CA49E] hover:text-[#5A6660]"
                        >
                          Reset to the shared terms
                        </button>
                      ) : (
                        <button
                          onClick={() => enterCustom(c)}
                          className="shrink-0 text-[11.5px] font-semibold text-[#1F7A5C] hover:underline"
                        >
                          Need a custom split? →
                        </button>
                      )}
                    </div>

                    {expanded && (
                      <div className="border-t border-[#F1EFE9] bg-[#FCFCFA] px-3.5 py-3">
                        {g.custom ? (
                          <div className="space-y-1.5">
                            {g.rows.map((r, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="w-4 shrink-0 text-[11px] text-[#9CA49E]">
                                  {i + 1}
                                </span>
                                <div className="relative w-28 shrink-0">
                                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[12.5px] text-[#9CA49E]">
                                    £
                                  </span>
                                  <input
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
                                    aria-label={`Instalment ${i + 1} amount`}
                                    className={`${inputClass} w-full pl-6`}
                                  />
                                </div>
                                <input
                                  type="date"
                                  value={r.date}
                                  onChange={(e) =>
                                    setGrant(c.id, {
                                      rows: g.rows.map((row, idx) =>
                                        idx === i ? { ...row, date: e.target.value } : row,
                                      ),
                                    })
                                  }
                                  aria-label={`Instalment ${i + 1} date`}
                                  className={`${inputClass} min-w-0 flex-1`}
                                />
                                {g.rows.length > 1 && (
                                  <button
                                    onClick={() =>
                                      setGrant(c.id, {
                                        rows: g.rows.filter((_, idx) => idx !== i),
                                      })
                                    }
                                    className="shrink-0 rounded p-1 text-[#C9C4B6] hover:bg-[#FBEEF2] hover:text-[#A34D68]"
                                    aria-label={`Remove instalment ${i + 1}`}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            ))}

                            <div className="flex gap-4 pt-1">
                              <button
                                onClick={() =>
                                  setGrant(c.id, { rows: [...g.rows, { amount: '0', date: '' }] })
                                }
                                className="text-[12px] font-semibold text-[#1F7A5C] hover:underline"
                              >
                                + Add instalment
                              </button>
                              <button
                                onClick={() => splitEvenly(c)}
                                className="text-[12px] font-medium text-[#5A6660] hover:text-[#202823]"
                              >
                                Split evenly
                              </button>
                            </div>

                            {/* Allocation guardrail: the schedule must sum to the award,
                                and it is much easier to fix while you are looking at it
                                than to decode from a validation message on the last step. */}
                            <div
                              className={`mt-1 flex items-center justify-between rounded-lg px-3 py-2 text-[12px] ${
                                reconciled
                                  ? 'bg-[#DFF3EA] text-[#1F7A5C]'
                                  : 'bg-[#FAEEDA] text-[#854F0B]'
                              }`}
                            >
                              <span>
                                {reconciled
                                  ? 'Fully allocated'
                                  : remaining > 0
                                    ? `${fmtMoney(remaining)} left to allocate`
                                    : `${fmtMoney(-remaining)} over-allocated`}
                              </span>
                              <span className="font-semibold">
                                {fmtMoney(allocated)} / {fmtMoney(amount)}
                              </span>
                            </div>
                            {!allPositive && (
                              <p className="text-[11.5px] text-[#854F0B]">
                                Every instalment must be more than £0.
                              </p>
                            )}
                          </div>
                        ) : (
                          <dl className="space-y-1">
                            {schedule.map((r, i) => (
                              <div key={i} className="flex justify-between text-[12px]">
                                <dt className="text-[#5A6660]">
                                  Instalment {i + 1} of {schedule.length}
                                </dt>
                                <dd className="flex gap-3">
                                  <span className="font-medium text-[#202823]">
                                    {fmtMoney(r.amount)}
                                  </span>
                                  <span className="w-24 text-right text-[11px] text-[#9CA49E]">
                                    {r.date ? fmtDate(r.date) : 'Date TBC'}
                                  </span>
                                </dd>
                              </div>
                            ))}
                            <div className="mt-1 flex justify-between border-t border-[#ECEAE3] pt-1.5 text-[12px]">
                              <span className="text-[#5A6660]">Total</span>
                              <span className="font-semibold text-[#1F7A5C]">
                                {fmtMoney(allocated)}
                              </span>
                            </div>
                          </dl>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <FieldLabel>Reporting milestones</FieldLabel>
            <p className="mb-2 text-[11px] text-[#9CA49E]">
              The dates you expect a report on. They appear on every letter and in the Reports
              screen once the grants are live.
            </p>
            <div className="space-y-2">
              {terms.reporting.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
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
                    className={`${inputClass} flex-1`}
                  />
                  <input
                    type="date"
                    value={r.date}
                    onChange={(e) =>
                      setTerms((t) => ({
                        ...t,
                        reporting: t.reporting.map((row, idx) =>
                          idx === i ? { ...row, date: e.target.value } : row,
                        ),
                      }))
                    }
                    aria-label={`Reporting milestone ${i + 1} date`}
                    className={`${inputClass} w-40`}
                  />
                  <button
                    onClick={() =>
                      setTerms((t) => ({
                        ...t,
                        reporting: t.reporting.filter((_, idx) => idx !== i),
                      }))
                    }
                    className="shrink-0 rounded p-1 text-[#C9C4B6] hover:bg-[#FBEEF2] hover:text-[#A34D68]"
                    aria-label="Remove milestone"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() =>
                setTerms((t) => ({ ...t, reporting: [...t.reporting, { label: '', date: '' }] }))
              }
              className="mt-2 text-[12.5px] font-semibold text-[#1F7A5C] hover:underline"
            >
              + Add reporting milestone
            </button>
          </div>

          <div>
            <FieldLabel>Conditions of grant</FieldLabel>
            <div className="overflow-hidden rounded-xl border border-[#ECEAE3]">
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
                  className="h-4 w-4 accent-[#1F7A5C]"
                />
                <span className="flex-1">
                  <span className="block text-[12.5px] font-medium text-[#202823]">
                    Attach your standard conditions
                  </span>
                  <span className="block text-[11px] text-[#9CA49E]">
                    {conditions.length} clause{conditions.length === 1 ? '' : 's'} · they appear on
                    every award letter
                  </span>
                </span>
              </label>
              {terms.useStandardConditions && (
                <div className="border-t border-[#F1EFE9] bg-[#FCFCFA] px-3.5 py-3">
                  <ol className="list-decimal space-y-1.5 pl-4 text-[11.5px] leading-relaxed text-[#5A6660]">
                    {conditions.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ol>
                  <Link
                    to="/settings/award-letter"
                    className="mt-2.5 inline-block text-[12px] font-semibold text-[#1F7A5C] hover:underline"
                  >
                    Edit your standard conditions in Settings →
                  </Link>
                </div>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-[#9CA49E]">
              A condition that applies to one grant alone goes on that grant, back in step 1.
            </p>
          </div>
        </div>
      )}

      {/* ── 3. Letters ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-[#ECEAE3] bg-white">
            {[
              {
                l: selected.length === 1 ? 'Award' : 'Awards in this batch',
                v: selected.length === 1 ? selected[0]!.organisationName : String(selected.length),
              },
              { l: 'Total committed', v: fmtMoney(totalCommitted), emph: true },
              { l: 'Grant start date', v: fmtDate(terms.startDate) },
              {
                l: 'Payment structure',
                v:
                  (terms.instalments === 1
                    ? 'Single payment'
                    : `${terms.instalments} instalments`) +
                  (selected.some((c) => grants[c.id]!.custom)
                    ? ` · ${selected.filter((c) => grants[c.id]!.custom).length} custom`
                    : ''),
              },
              {
                l: 'Reporting milestones',
                v: String(terms.reporting.filter((r) => r.label.trim() && r.date).length),
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
                className={`flex items-center justify-between px-4 py-3 ${
                  i < all.length - 1 ? 'border-b border-[#F1EFE9]' : ''
                } ${row.emph ? 'bg-[#FAF9F6]' : ''}`}
              >
                <span className="text-[12.5px] text-[#5A6660]">{row.l}</span>
                <span
                  className={
                    row.emph
                      ? 'font-display text-[15px] text-[#1F7A5C]'
                      : 'text-[13px] font-medium text-[#202823]'
                  }
                >
                  {row.v}
                </span>
              </div>
            ))}
          </div>

          <div>
            <FieldLabel>Award letters</FieldLabel>
            <p className="mb-2 text-[11.5px] text-[#9CA49E]">
              Sent from{' '}
              <strong className="text-[#5A6660]">
                {letterSettings?.senderName || letterSettings?.foundationName || 'your foundation'}
              </strong>
              {letterSettings?.replyTo ? (
                <>
                  , with replies going to{' '}
                  <strong className="text-[#5A6660]">{letterSettings.replyTo}</strong>
                </>
              ) : (
                <>
                  . No reply-to address is set, so replies come back to Custodian —{' '}
                  <Link
                    to="/settings/award-letter"
                    className="font-semibold text-[#1F7A5C] hover:underline"
                  >
                    set one in Settings
                  </Link>
                  .
                </>
              )}
            </p>
            <div className="overflow-hidden rounded-xl border border-[#ECEAE3] bg-white">
              {selected.map((c, i) => {
                const letter = letterFor(c)
                const open = openLetter === c.id
                return (
                  <div
                    key={c.id}
                    className={i < selected.length - 1 ? 'border-b border-[#F1EFE9]' : ''}
                  >
                    <button
                      onClick={() => setOpenLetter(open ? null : c.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#FCFCFA]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[12.5px] font-medium text-[#202823]">
                          {c.organisationName}
                        </span>
                        <span className="block truncate text-[11px] text-[#9CA49E]">
                          {c.applicantEmail ?? 'No contact email — will be saved, not sent'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11.5px] font-semibold text-[#1F7A5C]">
                        {open ? 'Hide' : 'Preview'}
                      </span>
                    </button>
                    {open && (
                      <div className="border-t border-[#F1EFE9] bg-[#FCFCFA] px-4 py-4">
                        <div className="mb-2 text-[11px] text-[#9CA49E]">
                          Subject: <span className="text-[#5A6660]">{letter.subject}</span>
                        </div>
                        <AwardLetterPreview bodyText={letter.bodyText} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {missingPurpose.length > 0 && (
            <div className="rounded-xl bg-[#FAEEDA] px-4 py-3 text-[12px] leading-relaxed text-[#854F0B]">
              {missingPurpose.length === 1
                ? `${missingPurpose[0]!.organisationName} has no grant purpose — its letter will read “[not set]”.`
                : `${missingPurpose.length} grants have no purpose — their letters will read “[not set]”.`}{' '}
              Go back to Grants to fill them in.
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="mt-6 border-t border-[#ECEAE3] pt-4">
        {problems.length > 0 && step === LAST_STEP && (
          <ul className="mb-3 space-y-1">
            {problems.map((p) => (
              <li key={p} className="text-[12px] text-[#A34D68]">
                {p}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mb-3 text-[12px] text-[#A34D68]">{error}</p>}
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              step === 1 ? navigate({ to: '/shortlist', search: { roundId } }) : setStep(step - 1)
            }
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </Button>
          {step < LAST_STEP ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={selected.length === 0}
              className="flex-1"
            >
              Continue →
            </Button>
          ) : (
            <Button
              onClick={handleConfirm}
              disabled={saving || problems.length > 0}
              className="flex-1"
            >
              {saving
                ? 'Creating…'
                : `Confirm & send ${selected.length === 1 ? 'award letter' : `${selected.length} award letters`}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
