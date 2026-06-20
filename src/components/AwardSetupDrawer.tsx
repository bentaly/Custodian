import { useEffect, useMemo, useState } from 'react'
import { generateAward } from '../server/fns/applications'

type AwardableApplication = {
  id: string
  organisationName: string
  amountRequested: string
}

function fmt(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

// Even split with the remainder folded into the final instalment; dates spaced a
// year apart from the first payment date (null = "date TBC"). Deliberately simple.
function buildSchedule(total: number, n: number, firstDate: string) {
  const base = Math.floor(total / n)
  return Array.from({ length: n }, (_, i) => {
    const amount = i === n - 1 ? total - base * (n - 1) : base
    let date: string | null = null
    if (firstDate) {
      const d = new Date(firstDate)
      d.setFullYear(d.getFullYear() + i)
      date = d.toISOString().slice(0, 10)
    }
    return { instalment: i + 1, amount, date }
  })
}

function fmtDate(iso: string | null) {
  if (!iso) return 'Date TBC'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function AwardSetupDrawer({
  application,
  open,
  onClose,
  onAwarded,
}: {
  application: AwardableApplication
  open: boolean
  onClose: () => void
  onAwarded: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [amount, setAmount] = useState(() => application.amountRequested)
  const [instalments, setInstalments] = useState(1)
  const [firstDate, setFirstDate] = useState('')
  const [reportingRows, setReportingRows] = useState<Array<{ label: string; date: string }>>([
    { label: '', date: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form whenever a different application is opened.
  useEffect(() => {
    setStep(1)
    setAmount(application.amountRequested)
    setInstalments(1)
    setFirstDate('')
    setReportingRows([{ label: '', date: '' }])
    setError(null)
  }, [application.id])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const amountNum = parseFloat(amount) || 0
  const schedule = useMemo(
    () => buildSchedule(amountNum, instalments, firstDate),
    [amountNum, instalments, firstDate],
  )

  const filledReportingRows = reportingRows.filter((r) => r.label.trim() && r.date)

  async function handleConfirm() {
    setError(null)
    setSaving(true)
    try {
      await generateAward({
        data: {
          id: application.id,
          amountAwarded: amountNum,
          schedule: schedule.map((s) => ({
            instalment: s.instalment,
            amount: s.amount,
            date: s.date,
          })),
          reportingDates: filledReportingRows,
        },
      })
      onAwarded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate award')
    } finally {
      setSaving(false)
    }
  }

  function updateReportingRow(i: number, field: 'label' | 'date', value: string) {
    setReportingRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  function addReportingRow() {
    setReportingRows((rows) => [...rows, { label: '', date: '' }])
  }

  function removeReportingRow(i: number) {
    setReportingRows((rows) => rows.filter((_, idx) => idx !== i))
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-200 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Set up award"
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Set up award</h2>
            <p className="mt-0.5 text-sm text-gray-500">{application.organisationName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex shrink-0 border-b border-gray-100 px-6">
          {[
            { n: 1 as const, l: 'Details' },
            { n: 2 as const, l: 'Schedule' },
            { n: 3 as const, l: 'Reporting' },
          ].map((s) => (
            <button
              key={s.n}
              onClick={() => setStep(s.n)}
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm font-medium ${
                step === s.n
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {s.n}. {s.l}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount awarded</label>
                <p className="mb-2 text-xs text-gray-400">
                  Requested {fmt(parseFloat(application.amountRequested))}
                </p>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                    £
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded border border-gray-200 py-2 pl-7 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Number of instalments
                </label>
                <div className="mt-2 flex gap-2">
                  {[1, 2, 3, 4].map((num) => (
                    <button
                      key={num}
                      onClick={() => setInstalments(num)}
                      className={`h-9 w-10 rounded border text-sm font-semibold ${
                        instalments === num
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  First payment date
                </label>
                <input
                  type="date"
                  value={firstDate}
                  onChange={(e) => setFirstDate(e.target.value)}
                  className="mt-2 w-full rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              <div className="rounded-lg bg-gray-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Schedule
                </p>
                <dl className="space-y-1.5">
                  {schedule.map((s) => (
                    <div
                      key={s.instalment}
                      className="flex items-center justify-between text-sm"
                    >
                      <dt className="text-gray-500">
                        Instalment {s.instalment} of {instalments}
                      </dt>
                      <dd className="flex items-center gap-3">
                        <span className="font-medium text-gray-700">{fmt(s.amount)}</span>
                        <span className="w-24 text-right text-xs text-gray-400">
                          {fmtDate(s.date)}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-sm">
                  <span className="text-gray-500">Total</span>
                  <span className="font-semibold text-emerald-700">{fmt(amountNum)}</span>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400 leading-relaxed">
                Set reporting dates manually. These will appear in the reporting hub once the grant
                is activated.
              </p>

              <div className="space-y-2">
                {reportingRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Milestone label"
                      value={row.label}
                      onChange={(e) => updateReportingRow(i, 'label', e.target.value)}
                      className="flex-1 rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                    <input
                      type="date"
                      value={row.date}
                      onChange={(e) => updateReportingRow(i, 'date', e.target.value)}
                      className="w-36 rounded border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                    />
                    {reportingRows.length > 1 && (
                      <button
                        onClick={() => removeReportingRow(i)}
                        className="shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                        aria-label="Remove row"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={addReportingRow}
                className="text-sm font-medium text-emerald-700 hover:text-emerald-800"
              >
                + Add reporting milestone
              </button>

              {filledReportingRows.length === 0 && (
                <div className="rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
                  No reporting milestones added. At least one is recommended.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-gray-100 px-6 py-4">
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            {step < 3 ? (
              <button
                onClick={() => setStep((step + 1) as 2 | 3)}
                disabled={amountNum <= 0}
                className="flex-[2] rounded bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Continue →
              </button>
            ) : (
              <button
                onClick={handleConfirm}
                disabled={saving || amountNum <= 0}
                className="flex-[2] rounded bg-emerald-600 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Generating…' : '✓ Generate award'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
