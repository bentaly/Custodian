import { useEffect, useState } from 'react'
import { API_BASE } from './api'

// Verified against the live registers — handy presets for exercising each
// due diligence outcome from the form.
const TEST_CASES: Array<{
  label: string
  expected: string
  organisationName: string
  charityNumber?: string
  companyNumber?: string
  amountRequested?: string
}> = [
  {
    label: 'Kids Company — removed charity',
    expected: 'BLOCKED (removed from register)',
    organisationName: 'Keeping Kids Company',
    charityNumber: '1068298',
  },
  {
    label: 'Carillion plc — company in liquidation',
    expected: 'BLOCKED (company not active)',
    organisationName: 'Carillion plc',
    companyNumber: '03782379',
  },
  {
    label: 'Oxfam — active charity',
    expected: 'WARNING (income trend)',
    organisationName: 'Oxfam',
    charityNumber: '202918',
  },
  {
    label: 'Charity 219279 — overdue accounts',
    expected: 'WARNING (accounts overdue + deficit)',
    organisationName: 'Test Charity Organisation',
    charityNumber: '219279',
  },
  {
    label: 'Scottish charity (OSCR path)',
    expected: 'CLEAR',
    organisationName: 'Scottish Test Charity',
    charityNumber: 'SC003558',
  },
]

type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'multi_select' | 'date' | 'file' | 'checkbox'

interface FormField {
  id: string
  label: string
  fieldType: FieldType
  required: boolean
  options?: string[]
  displayOrder: number
}

interface Programme {
  id: string
  roundProgrammeId: string
  name: string
  description: string | null
  formFields: FormField[]
}

interface Round {
  id: string
  name: string
  client: {
    id: string
    name: string
  }
  programmes: Programme[]
}

interface DueDiligenceCheck {
  key: string
  source: string
  result: 'pass' | 'fail' | 'unverified'
  detail: string | null
}

interface DueDiligence {
  status: 'pending' | 'clear' | 'warning' | 'blocked' | 'review'
  checks: DueDiligenceCheck[]
  checkedAt: string
}

interface SubmitResult {
  status: 'complete' | 'ai_proposed' | 'needs_review'
  ingestId: string
  applicationId: string | null
  duplicate: boolean
  // Present when the ingest created an application (complete / ai_proposed).
  application?: {
    id: string
    organisationName: string
    charityNumber: string | null
    companyNumber: string | null
    bankName: string
    bankAccountName: string
    bankAccountNumber: string
    bankSortCode: string
    amountRequested: string
    status: string
    submittedAt: string
  } | null
  dueDiligence?: DueDiligence | null
}

interface RoundSummary {
  id: string
  name: string
  openedAt: string | null
  closedAt: string | null
  client: { id: string; name: string }
}

interface ExtraField {
  id: string
  label: string
  value: string
}

export function Submitter() {
  const [allRounds, setAllRounds] = useState<RoundSummary[]>([])
  const [clientId, setClientId] = useState<string | null>(null)
  const [roundId, setRoundId] = useState<string | null>(null)
  const [round, setRound] = useState<Round | null>(null)
  const [programmeId, setProgrammeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    organisationName: 'Test Charity Organisation',
    charityNumber: '219279',
    companyNumber: '',
    bankName: 'Barclays Bank',
    bankAccountName: 'Test Charity Organisation',
    bankAccountNumber: '12345678',
    bankSortCode: '20-00-00',
    amountRequested: '15000',
    // Extra fields sent as part of the payload (not required by the API, just extra data)
    referralSource: 'Partner organisation',
    previousFunding: 'No previous funding received',
  })

  const [responses, setResponses] = useState<Record<string, string>>({})
  const [extraFields, setExtraFields] = useState<ExtraField[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/rounds`)
      .then((r) => r.json())
      .then((data: RoundSummary[]) => {
        if (!data.length) throw new Error('No rounds found')
        setAllRounds(data)
        const firstClientId = data[0]!.client.id
        setClientId(firstClientId)
        setRoundId(data.find((r) => r.client.id === firstClientId)?.id ?? data[0]!.id)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!roundId) return
    setRound(null)
    setProgrammeId(null)
    fetch(`${API_BASE}/api/round/${roundId}`)
      .then((r) => r.json())
      .then((data: Round & { error?: string }) => {
        if (data.error) throw new Error(data.error)
        if (!data.programmes?.length) throw new Error('Round has no programmes')
        setRound(data)
        setProgrammeId(data.programmes[0]!.id)
      })
      .catch((e: Error) => setError(e.message))
  }, [roundId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    setResult(null)

    try {
      if (!round || !programme || !clientId) throw new Error('No client, round or programme selected')
      const selectedProgramme = programme
      // Posts to /api/apply — the single public submission path a real foundation
      // submission takes. The programme is identified by name; fields go in as a raw
      // payload (here under their canonical names, which resolve by exact-match).
      const res = await fetch(`${API_BASE}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          externalApplicationId: `TEST-${Date.now()}`,
          payload: {
            programmeName: selectedProgramme.name,
            organisationName: form.organisationName,
            charityNumber: form.charityNumber || undefined,
            companyNumber: form.companyNumber || undefined,
            bankName: form.bankName,
            bankAccountName: form.bankAccountName,
            bankAccountNumber: form.bankAccountNumber,
            bankSortCode: form.bankSortCode,
            amountRequested: form.amountRequested,
            'How did you hear about us?': form.referralSource,
            'Previous funding received': form.previousFunding,
            ...Object.fromEntries(
              (selectedProgramme.formFields ?? [])
                .filter((f) => responses[f.id] !== undefined && responses[f.id] !== '')
                .map((f) => [f.label, responses[f.id]!]),
            ),
            ...Object.fromEntries(
              extraFields
                .filter((f) => f.label.trim() && f.value.trim())
                .map((f) => [f.label.trim(), f.value.trim()]),
            ),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = data.fields
          ? `${data.error}: ${data.fields.map((f: { field: string; message: string }) => `${f.field} (${f.message})`).join(', ')}`
          : (data.error ?? `HTTP ${res.status}`)
        throw new Error(msg)
      }
      setResult(data)
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Card><p className="text-gray-500 text-sm">Loading rounds…</p></Card>
  if (error) return <Card><p className="text-red-600 text-sm">Error: {error}</p></Card>

  const clients = Array.from(
    new Map(allRounds.map((r) => [r.client.id, r.client])).values()
  )
  const rounds = clientId ? allRounds.filter((r) => r.client.id === clientId) : allRounds

  const programme = round && programmeId
    ? (round.programmes.find((p) => p.id === programmeId) ?? round.programmes[0]!)
    : null
  const fields = (programme?.formFields ?? []) as FormField[]

  function addExtraField() {
    setExtraFields((fs) => [...fs, { id: crypto.randomUUID(), label: '', value: '' }])
  }
  function removeExtraField(id: string) {
    setExtraFields((fs) => fs.filter((f) => f.id !== id))
  }
  function updateExtraField(id: string, key: 'label' | 'value', val: string) {
    setExtraFields((fs) => fs.map((f) => f.id === id ? { ...f, [key]: val } : f))
  }

  return (
    <Card>
      {result && (
        <button
          onClick={() => setResult(null)}
          className="mb-6 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
        >
          ← Submit another
        </button>
      )}
      <div className={`mb-8 ${result ? 'hidden' : ''}`}>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
              Client
            </label>
            <select
              value={clientId ?? ''}
              onChange={(e) => {
                const newClientId = e.target.value
                setClientId(newClientId)
                const firstRound = allRounds.find((r) => r.client.id === newClientId)
                setRoundId(firstRound?.id ?? null)
                setResponses({})
                setResult(null)
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
              Round
            </label>
            <select
              value={roundId ?? ''}
              onChange={(e) => {
                setRoundId(e.target.value)
                setResponses({})
                setResult(null)
              }}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          {round && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                Programme
              </label>
              <select
                value={programmeId ?? ''}
                onChange={(e) => {
                  setProgrammeId(e.target.value)
                  setResponses({})
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {round.programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {programme && (
          <>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 mt-6">
              {round!.client.name}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">{programme.name}</h1>
            {programme.description && (
              <p className="mt-2 text-sm text-gray-600">{programme.description}</p>
            )}
          </>
        )}
      </div>

      {!round && (
        <p className="text-gray-400 text-sm py-4">Loading round…</p>
      )}
      {result ? (
        <SuccessView result={result} />
      ) : round && programme ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Quick-fill presets — verified against the live registers */}
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Quick fill — due diligence test cases
            </p>
            <div className="flex flex-wrap gap-2">
              {TEST_CASES.map((tc) => (
                <button
                  key={tc.label}
                  type="button"
                  title={`Expected: ${tc.expected}`}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      organisationName: tc.organisationName,
                      charityNumber: tc.charityNumber ?? '',
                      companyNumber: tc.companyNumber ?? '',
                      amountRequested: tc.amountRequested ?? f.amountRequested,
                    }))
                  }
                  className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:border-indigo-400 hover:text-indigo-700"
                >
                  {tc.label}
                </button>
              ))}
            </div>
          </div>

          {/* Organisation */}
          <Section title="Organisation">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Organisation name" required>
                <input
                  required
                  value={form.organisationName}
                  onChange={(e) => setForm((f) => ({ ...f, organisationName: e.target.value }))}
                />
              </Field>

              <Field label="Amount requested (£)" required>
                <input
                  required
                  type="number"
                  min={1}
                  max={500000}
                  value={form.amountRequested}
                  onChange={(e) => setForm((f) => ({ ...f, amountRequested: e.target.value }))}
                />
              </Field>

              <Field label="Charity number" hint="Charity Commission (E&W) or OSCR (SC… prefix). Leave blank if none.">
                <input
                  value={form.charityNumber}
                  onChange={(e) => setForm((f) => ({ ...f, charityNumber: e.target.value }))}
                  placeholder="e.g. 219279 or SC003558"
                />
              </Field>

              <Field label="Company number" hint="Companies House. Leave blank if none.">
                <input
                  value={form.companyNumber}
                  onChange={(e) => setForm((f) => ({ ...f, companyNumber: e.target.value }))}
                  placeholder="e.g. 03782379"
                />
              </Field>
            </div>
          </Section>

          {/* Banking */}
          <Section title="Banking details">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="Bank name" required>
                <input
                  required
                  value={form.bankName}
                  onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                  placeholder="e.g. Barclays Bank"
                />
              </Field>

              <Field label="Account name" required>
                <input
                  required
                  value={form.bankAccountName}
                  onChange={(e) => setForm((f) => ({ ...f, bankAccountName: e.target.value }))}
                />
              </Field>

              <Field label="Account number" required>
                <input
                  required
                  value={form.bankAccountNumber}
                  onChange={(e) => setForm((f) => ({ ...f, bankAccountNumber: e.target.value }))}
                  placeholder="e.g. 12345678"
                />
              </Field>

              <Field label="Sort code" required>
                <input
                  required
                  value={form.bankSortCode}
                  onChange={(e) => setForm((f) => ({ ...f, bankSortCode: e.target.value }))}
                  placeholder="e.g. 20-00-00"
                />
              </Field>
            </div>
          </Section>

          {/* Extra fields (not API-required, just additional data) */}
          <Section title="Additional information">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="How did you hear about us?">
                <select
                  value={form.referralSource}
                  onChange={(e) => setForm((f) => ({ ...f, referralSource: e.target.value }))}
                >
                  <option>Partner organisation</option>
                  <option>Social media</option>
                  <option>Word of mouth</option>
                  <option>Our website</option>
                  <option>Other</option>
                </select>
              </Field>

              <Field label="Previous funding received">
                <input
                  value={form.previousFunding}
                  onChange={(e) => setForm((f) => ({ ...f, previousFunding: e.target.value }))}
                  placeholder="e.g. £10,000 from ABC Foundation in 2023"
                />
              </Field>
            </div>
          </Section>

          {fields.length > 0 && (
            <Section title="Programme questions">
              <div className="space-y-5">
                {fields.map((field) => (
                  <DynamicField
                    key={field.id}
                    field={field}
                    value={responses[field.id] ?? ''}
                    onChange={(v) => setResponses((r) => ({ ...r, [field.id]: v }))}
                  />
                ))}
              </div>
            </Section>
          )}

          <Section title="Extra fields">
            <div className="space-y-3">
              {extraFields.map((f) => (
                <div key={f.id} className="flex gap-2 items-start">
                  <div className="flex-1">
                    <input
                      placeholder="Field name"
                      value={f.label}
                      onChange={(e) => updateExtraField(f.id, 'label', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      placeholder="Value"
                      value={f.value}
                      onChange={(e) => updateExtraField(f.id, 'value', e.target.value)}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeExtraField(f.id)}
                    className="mt-0.5 rounded-md border border-gray-300 px-2.5 py-2 text-sm text-gray-500 hover:border-red-300 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addExtraField}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                + Add field
              </button>
            </div>
          </Section>

          {submitError && (
            <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </form>
      ) : null}
    </Card>
  )
}

const DD_STATUS_STYLES: Record<DueDiligence['status'], string> = {
  pending: 'border-gray-200 bg-gray-50 text-gray-600',
  clear: 'border-green-200 bg-green-50 text-green-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  blocked: 'border-red-200 bg-red-50 text-red-700',
  review: 'border-blue-200 bg-blue-50 text-blue-700',
}

const DD_OUTCOME_STYLES: Record<DueDiligenceCheck['result'], { symbol: string; className: string }> = {
  pass: { symbol: '✓', className: 'text-green-600' },
  fail: { symbol: '✕', className: 'text-red-600' },
  unverified: { symbol: '–', className: 'text-gray-400' },
}

const INGEST_STATUS_STYLES: Record<SubmitResult['status'], string> = {
  complete: 'border-green-200 bg-green-50 text-green-800',
  ai_proposed: 'border-blue-200 bg-blue-50 text-blue-800',
  needs_review: 'border-amber-200 bg-amber-50 text-amber-800',
}

function SuccessView({ result }: { result: SubmitResult }) {
  const { application, dueDiligence, status, ingestId, duplicate } = result
  return (
    <div className="space-y-6">
      <div className={`rounded-lg border px-5 py-4 ${INGEST_STATUS_STYLES[status]}`}>
        <h2 className="text-sm font-semibold">
          Ingested — {status.replace('_', ' ')}
          {duplicate && ' (duplicate — existing record returned)'}
        </h2>
        <p className="mt-1 text-xs opacity-80">Ingest ID: {ingestId}</p>
        {application ? (
          <p className="mt-0.5 text-xs opacity-80">Application: {application.id} · {application.status}</p>
        ) : (
          <p className="mt-0.5 text-xs opacity-80">
            Held for review — resolve it in the Review queue to create the application.
          </p>
        )}
      </div>

      {application && (
        <>
          {dueDiligence ? (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                  Due diligence
                </h3>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium ${DD_STATUS_STYLES[dueDiligence.status]}`}
                >
                  {dueDiligence.status}
                </span>
              </div>
              <ul className="space-y-1.5 rounded-lg border border-gray-200 bg-white p-4">
                {dueDiligence.checks.map((c) => {
                  const o = DD_OUTCOME_STYLES[c.result]
                  return (
                    <li key={c.key} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 w-3 shrink-0 font-semibold ${o.className}`}>{o.symbol}</span>
                      <span className="text-gray-700">{c.key}</span>
                      <span className="text-xs text-gray-400">[{c.source}]</span>
                      {c.detail && <span className="text-gray-400">— {c.detail}</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-700">
              No due diligence returned (no charity or company number supplied).
            </div>
          )}

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-gray-500">
              Application data
            </h3>
            <pre className="overflow-auto rounded-lg bg-gray-950 p-4 text-xs text-green-400">
              {JSON.stringify(application, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  )
}

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: FormField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field label={field.label} required={field.required}>
      {field.fieldType === 'textarea' ? (
        <textarea
          required={field.required}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.fieldType === 'select' && field.options ? (
        <select required={field.required} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : field.fieldType === 'date' ? (
        <input
          type="date"
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.fieldType === 'number' ? (
        <input
          type="number"
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          required={field.required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-gray-200 pt-6 first:border-t-0 first:pt-0">
      <h2 className="mb-4 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {hint && <p className="mb-1 text-xs text-gray-400">{hint}</p>}
      <div className="[&_input]:w-full [&_input]:rounded-md [&_input]:border [&_input]:border-gray-300 [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm [&_input]:outline-none [&_input]:focus:border-indigo-500 [&_input]:focus:ring-1 [&_input]:focus:ring-indigo-500 [&_select]:w-full [&_select]:rounded-md [&_select]:border [&_select]:border-gray-300 [&_select]:px-3 [&_select]:py-2 [&_select]:text-sm [&_select]:outline-none [&_select]:focus:border-indigo-500 [&_select]:focus:ring-1 [&_select]:focus:ring-indigo-500 [&_textarea]:w-full [&_textarea]:rounded-md [&_textarea]:border [&_textarea]:border-gray-300 [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:text-sm [&_textarea]:outline-none [&_textarea]:focus:border-indigo-500 [&_textarea]:focus:ring-1 [&_textarea]:focus:ring-indigo-500">
        {children}
      </div>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200">{children}</div>
    </div>
  )
}
