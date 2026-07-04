import { useState } from 'react'
import { API_BASE } from './api'

// Test submitter for /api/submit-report — simulates a foundation's grant-report
// form posting a charity's answers, authenticated with the same API key as
// /api/apply (shared localStorage). Two presets exercise the two pipeline paths:
//
//   • 7stars-style — the real report form's labels, INCLUDING an application
//     reference (the "hidden field" a well-configured form embeds). Every field
//     auto-maps via the common dictionary; if the reference matches an awarded
//     application, the report auto-links and lands complete with AI analysis.
//   • Arete-style — the real Typeform export's labels, NO reference anywhere.
//     Fields map fine but the report holds in the Report queue for a human to
//     pick the grant from the ranked candidates.

interface ReportField {
  key: string
  value: string
  note?: string
}

const PREFILL_7STARS: ReportField[] = [
  {
    key: 'Application reference',
    value: '',
    note: 'The hidden-field app reference — set it to an awarded application’s external ID to auto-link, or leave blank / use a wrong value to hold for review.',
  },
  { key: "Charity's name", value: 'Brighter Futures Leeds' },
  { key: "Charity's registration number", value: '1156789' },
  { key: 'Funding stream the grant was awarded from', value: 'Social Impact Funding' },
  { key: 'Funding award amount', value: '£10,000' },
  { key: 'Date of funding award', value: '15/01/2026' },
  { key: 'Funding title', value: 'Peer mentoring for young carers' },
  {
    key: 'Grant Awarded Summary',
    value:
      'The grant funded our peer-mentoring programme for young carers aged 11-17 across Leeds, pairing trained sixth-form mentors with younger carers for weekly sessions.',
  },
  {
    key: 'Grant Impact Summary',
    value:
      'Across the six months we delivered 22 weekly sessions and supported 84 young carers, of whom 61 completed the full programme. School attendance among completers rose from 81% to 92%, and self-reported wellbeing (WEMWBS) improved by an average of 9 points. Two mentees have joined our youth advisory board.',
  },
  {
    key: 'Did you face any challenges in delivering the grant, how were these overcome?',
    value:
      'Recruiting mentors in the summer term was slower than planned; we partnered with two additional sixth forms and ran a taster day, which filled the cohort by September.',
  },
  {
    key: 'Please provide a summary of learnings from the grant delivery',
    value:
      'Shorter, more frequent sessions kept younger carers engaged better than fortnightly longer ones. We will bake this into the next cohort.',
  },
  {
    key: 'Are you able to share any anonymous case studies?',
    value:
      'One 13-year-old carer for a parent with MS went from three school refusals a week to full attendance and now mentors a younger peer.',
  },
  {
    key: 'Are you able to share any testimonials?',
    value: '"The first place I’ve met people who get what my life is like." — mentee, 14',
  },
  { key: 'Number of beneficiaries (0-18 Years)', value: '84' },
  { key: 'Project Delivery Region', value: 'Yorkshire and the Humber' },
  { key: 'Any other comments?', value: 'Thank you — the flexibility of the funding made the pivot possible.' },
]

const PREFILL_ARETE: ReportField[] = [
  { key: 'Charity Name', value: 'The Inclusive Hub CIC' },
  { key: 'Charity Number', value: '12426807' },
  { key: 'Name of representative and contact', value: 'Alan Johnson - alanjohnson30@hotmail.com' },
  { key: 'Geographical Location', value: 'Bootle, Merseyside' },
  { key: 'When did our partnership start?', value: '22/06/2022' },
  {
    key: 'How was our funding intended to support your delivery of tangible local impact?',
    value:
      'The funding was to support our Head Coach to expand and develop our delivery programmes and for our Business Development Manager to explore sustainability and expansion models.',
  },
  { key: 'How much funding have you received to date? (£)', value: '9854' },
  {
    key: 'How has our funding made a difference to your scale and growth since we last touched base?',
    value:
      'Since we last touched base we have settled into our new premises and expanded delivery to five sessions a week. Around 120 disabled young people now attend each month, up from 70, and we have taken on two new sessional coaches.',
  },
  { key: 'Are you facing any challenges since your last report?', value: 'True' },
  {
    key: 'Please explain in further detail',
    value:
      'As we support acutely disadvantaged individuals who are often also financially disadvantaged, we cannot charge commercial rates for our services and need to continue diversifying income.',
  },
  {
    key: 'Are you able to share any testimonials/anonymous case studies related to the impact of our funding?',
    value:
      'A parent told us the hub is "the only place in the week my son is treated like everyone else".',
  },
  { key: 'Any other comments', value: 'Thank you for the continued partnership.' },
]

const PRESETS = [
  {
    key: '7stars',
    label: '7stars-style — with application reference (auto-links)',
    note: 'Every field auto-maps; set the reference to an awarded application’s external ID and the report links itself, ticks the next milestone and gets analysed.',
    fields: PREFILL_7STARS,
  },
  {
    key: 'arete',
    label: 'Arete-style — no reference (holds for matching)',
    note: 'Maps cleanly but has no application reference, so it holds in the Report queue with ranked grant suggestions — the Typeform reality.',
    fields: PREFILL_ARETE,
  },
]

interface SubmitResult {
  status: 'received'
  ingestId: string
}

export function SubmitterReport() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('apply_api_key') ?? '')
  const [presetKey, setPresetKey] = useState(PRESETS[0]!.key)
  const [fields, setFields] = useState<ReportField[]>(() =>
    PRESETS[0]!.fields.map((f) => ({ ...f })),
  )
  const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0]!
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  function pickPreset(key: string) {
    const p = PRESETS.find((x) => x.key === key) ?? PRESETS[0]!
    setPresetKey(p.key)
    setFields(p.fields.map((f) => ({ ...f })))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setSubmitError(null)
    setResult(null)
    try {
      if (!apiKey.trim()) throw new Error('Enter an API key (generate one on the Organisation screen)')
      const payload: Record<string, string> = {}
      for (const f of fields) {
        const v = f.value.trim()
        if (v) payload[f.key] = v
      }
      const res = await fetch(`${API_BASE}/api/submit-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setResult(data)
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl bg-white p-8 shadow-sm ring-1 ring-gray-200">
        {result ? (
          <>
            <button
              onClick={() => setResult(null)}
              className="mb-6 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              ← Submit another
            </button>
            <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-4 text-green-800">
              <h2 className="text-sm font-semibold">Accepted (202)</h2>
              <p className="mt-1 text-xs opacity-80">Ingest ID: {result.ingestId}</p>
              <p className="mt-0.5 text-xs opacity-80">
                Mapping, grant matching and AI analysis run in the background — check the Report
                queue for the outcome.
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600">
              Grant report — simulated foundation form
            </p>
            <h1 className="mt-1 text-2xl font-bold text-gray-900">Submit a test report</h1>
            <p className="mt-2 text-sm text-gray-600">
              Posts a charity's report answers to <code>/api/submit-report</code> with the
              foundation's field labels as raw payload keys.
            </p>

            <div className="mt-6 mb-8 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  API key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value)
                    localStorage.setItem('apply_api_key', e.target.value)
                  }}
                  placeholder="cust_sk_…  (generate on the Organisation screen)"
                  className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Report preset
                </label>
                <select
                  value={presetKey}
                  onChange={(e) => pickPreset(e.target.value)}
                  className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm"
                >
                  {PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 max-w-md text-xs text-amber-600">{preset.note}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {fields.map((f, i) => (
                <div key={`${presetKey}-${f.key}`}>
                  <label className="mb-1 block text-sm font-medium text-gray-700">{f.key}</label>
                  {f.note && <p className="mb-1 text-xs text-amber-600">{f.note}</p>}
                  {f.value.length > 90 ? (
                    <textarea
                      value={f.value}
                      rows={3}
                      onChange={(e) =>
                        setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  ) : (
                    <input
                      type="text"
                      value={f.value}
                      onChange={(e) =>
                        setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                      }
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  )}
                </div>
              ))}

              {submitError && (
                <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : 'Submit report'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
