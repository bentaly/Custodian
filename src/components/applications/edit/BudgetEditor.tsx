import { useState, type FormEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { Button, Input, MoneyInput } from '../../ui'
import { C } from '../../ui/tokens'
import { setBudget } from '../../../server/fns/applicationEdits'
import { fmtMoney } from '../../../lib/format'
import type { BudgetLine } from '../../../lib/budget/types'
import type { EditOutcome } from './FieldEditor'

// The application budget, as lines a person can correct: what the money is for and how
// much of it. The whole list is saved at once (it is the applicant's budget, stated
// again), and each line's extra columns from the form (`details`) ride along untouched.
//
// Deliberately NOT reconciled against the amount requested: an applicant may ask this
// funder for part of a larger budget, so the lines can rightly total more.

type Draft = { item: string; amount: string; details?: BudgetLine['details'] }

const toDraft = (l: BudgetLine): Draft => ({
  item: l.item,
  amount: String(l.amount),
  details: l.details,
})

export function BudgetEditor({
  applicationId,
  lines,
  onDone,
  onCancel,
}: {
  applicationId: string
  lines: BudgetLine[]
  onDone: (outcome: EditOutcome) => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<Draft[]>(() =>
    lines.length > 0 ? lines.map(toDraft) : [{ item: '', amount: '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed = draft.map((d) => ({ ...d, n: Number(d.amount.replace(/[£,\s]/g, '')) }))
  const total = parsed.reduce((s, d) => s + (Number.isFinite(d.n) ? d.n : 0), 0)
  const set = (i: number, patch: Partial<Draft>) =>
    setDraft((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  async function save(e: FormEvent) {
    e.preventDefault()
    // A row left completely empty is a row nobody meant; anything half filled is a
    // mistake worth saying so about rather than dropping.
    const kept = parsed.filter((d) => d.item.trim() || d.amount.trim())
    const bad = kept.find((d) => !d.item.trim() || !Number.isFinite(d.n) || d.n <= 0)
    if (bad) {
      setError('Every line needs what it is for and an amount above £0.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const outcome = await setBudget({
        data: {
          id: applicationId,
          lines: kept.map((d) => ({
            item: d.item.trim(),
            amount: Math.round(d.n * 100) / 100,
            ...(d.details ? { details: d.details } : {}),
          })),
        },
      })
      await router.invalidate()
      onDone(outcome)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <div className="grid grid-cols-[minmax(0,1fr)_160px_32px] gap-2">
        <span className="font-display text-label font-medium" style={{ color: C.sub }}>
          What it is for
        </span>
        <span className="font-display text-label font-medium" style={{ color: C.sub }}>
          Amount
        </span>
        <span />
        {draft.map((d, i) => (
          <div key={i} className="contents">
            <Input
              aria-label={`Line ${i + 1}: what it is for`}
              value={d.item}
              onChange={(e) => set(i, { item: e.target.value })}
              disabled={busy}
            />
            <MoneyInput
              label={`Line ${i + 1}: amount`}
              value={d.amount}
              onChange={(v) => set(i, { amount: v })}
              disabled={busy}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={Delete02Icon}
              aria-label={`Remove line ${i + 1}`}
              disabled={busy}
              onClick={() => setDraft((rows) => rows.filter((_, j) => j !== i))}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 font-display text-body"
          style={{ color: C.brand }}
          disabled={busy}
          onClick={() => setDraft((rows) => [...rows, { item: '', amount: '' }])}
        >
          <HugeiconsIcon icon={Add01Icon} size={16} />
          Add a line
        </button>
        <span className="font-display text-body font-medium tabular-nums" style={{ color: C.ink }}>
          Total {fmtMoney(total)}
        </span>
      </div>
      <p className="font-display text-label" style={{ color: C.sub }}>
        The applicant&rsquo;s budget as it will read in Custodian. What they sent is kept, and shown
        in View Submission. The lines need not add up to the amount requested.
      </p>
      {error && (
        <p className="font-display text-label" style={{ color: C.danger }} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}
