// ─── JSON submitter ──────────────────────────────────────────────────────────
//
// Post an arbitrary body to /api/apply or /api/submit-report. The form-based
// submitters are fine for the happy path, but they can only ever send well-formed
// payloads shaped like the form — and the interesting cases are the malformed ones:
// a foundation's own field names that the mapper has to guess at, an amount with a
// currency symbol in it, a programme that doesn't exist. Those are the submissions
// that end up held, and there was no way to produce one on purpose.
//
// The presets are those cases, each labelled with what it should do to the queue, so
// the mapping pipeline can be exercised end to end without hand-writing JSON.

import { useEffect, useMemo, useState } from 'react'
import { API_BASE, submitWithApiKey, useApplyApiKey } from './api'
import { Button, Callout, Card, SectionHeading, inputClass } from './ui'

type Endpoint = '/api/apply' | '/api/submit-report'

interface Preset {
  label: string
  endpoint: Endpoint
  /** What this should do once the pipeline gets hold of it. */
  expect: string
  /** `{{programme}}` is replaced with the programme selected on screen. */
  body: Record<string, unknown>
}

const PRESETS: Preset[] = [
  {
    label: 'Clean application (canonical names)',
    endpoint: '/api/apply',
    expect: 'Maps by exact match and promotes straight to an application.',
    body: {
      externalApplicationId: 'JSON-001',
      programmeName: '{{programme}}',
      organisationName: 'Test Charity Organisation',
      applicantEmail: 'grants@example.org',
      charityNumber: '219279',
      amountRequested: 15000,
      bankName: 'Barclays Bank',
      bankAccountName: 'Test Charity Organisation',
      bankAccountNumber: '12345678',
      bankSortCode: '20-00-00',
      deliveryArea: 'Tower Hamlets',
      budgetBreakdown: [
        { item: 'Staff costs', amount: 12000 },
        { item: 'Equipment', amount: 3000 },
      ],
    },
  },
  {
    label: 'Foundation’s own field names',
    endpoint: '/api/apply',
    expect:
      'Nothing matches by exact name, so the lookup table, the built-in dictionary and finally the AI fallback all get a turn. Watch what it guesses.',
    body: {
      'Your reference': 'JSON-002',
      'Which programme are you applying to?': '{{programme}}',
      'Name of your organisation': 'Test Charity Organisation',
      'Contact email address': 'grants@example.org',
      'Registered charity no.': '219279',
      'How much are you asking for?': '15000',
      'Bank name': 'Barclays Bank',
      'Name on the account': 'Test Charity Organisation',
      'Acc no': '12345678',
      'Sort code': '20-00-00',
      'Where will the work happen?': 'Tower Hamlets',
      'Tell us about your project': 'A pilot programme for young carers in east London.',
    },
  },
  {
    label: 'No charity or company number',
    endpoint: '/api/apply',
    expect:
      'Held on the one-of rule: with neither number there is no register to screen against, so due diligence could never run.',
    body: {
      externalApplicationId: 'JSON-003',
      programmeName: '{{programme}}',
      organisationName: 'Unregistered Community Group',
      applicantEmail: 'hello@example.org',
      amountRequested: 5000,
      bankName: 'Barclays Bank',
      bankAccountName: 'Unregistered Community Group',
      bankAccountNumber: '12345678',
      bankSortCode: '20-00-00',
    },
  },
  {
    label: 'Amount that will not parse',
    endpoint: '/api/apply',
    expect:
      'Every field maps, so the grid looks complete — but validation rejects the amount and it is held. This is the case the old queue could not explain at all.',
    body: {
      externalApplicationId: 'JSON-004',
      programmeName: '{{programme}}',
      organisationName: 'Test Charity Organisation',
      applicantEmail: 'grants@example.org',
      charityNumber: '219279',
      amountRequested: 'about fifteen thousand pounds',
      bankName: 'Barclays Bank',
      bankAccountName: 'Test Charity Organisation',
      bankAccountNumber: '12345678',
      bankSortCode: '20-00-00',
    },
  },
  {
    label: 'Programme that does not exist',
    endpoint: '/api/apply',
    expect: 'Nothing to file it under, so it lands in Out of round.',
    body: {
      externalApplicationId: 'JSON-005',
      programmeName: 'A Programme Nobody Runs',
      organisationName: 'Test Charity Organisation',
      applicantEmail: 'grants@example.org',
      charityNumber: '219279',
      amountRequested: 15000,
      bankName: 'Barclays Bank',
      bankAccountName: 'Test Charity Organisation',
      bankAccountNumber: '12345678',
      bankSortCode: '20-00-00',
    },
  },
  {
    label: 'Report with a matching reference',
    endpoint: '/api/submit-report',
    expect:
      'Auto-links only if a grant carries this exact application reference — change it to one you have awarded.',
    body: {
      externalApplicationId: 'JSON-001',
      organisationName: 'Test Charity Organisation',
      impactSummary:
        'We ran 24 sessions over six months and supported 130 young carers, exceeding our target of 100.',
      beneficiaryCount: 130,
      challenges: 'Recruitment was slower than planned over the summer holidays.',
      lessons: 'Partnering with schools earlier would have filled the first cohort faster.',
      contactName: 'A. Person',
      contactEmail: 'grants@example.org',
    },
  },
  {
    label: 'Report with no reference',
    endpoint: '/api/submit-report',
    expect:
      'Cannot auto-link, so it is held with ranked (heuristic) grant suggestions for you to confirm.',
    body: {
      organisationName: 'Test Charity Organisation',
      impactSummary: 'A short summary of what the grant achieved.',
      beneficiaryCount: 42,
      contactEmail: 'grants@example.org',
    },
  },
]

interface RoundSummary {
  id: string
  name: string
  openedAt: string | null
  closedAt: string | null
  client: { id: string; name: string }
}

interface RoundDetail {
  id: string
  name: string
  client: { id: string; name: string }
  programmes: Array<{ id: string; name: string }>
}

export function SubmitterJson() {
  const [apiKey] = useApplyApiKey()
  const [endpoint, setEndpoint] = useState<Endpoint>('/api/apply')
  const [text, setText] = useState('{\n  \n}')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [activePreset, setActivePreset] = useState<Preset | null>(null)

  // Real programme names, so a preset can be aimed at something that actually
  // exists — the commonest reason a hand-written test payload lands out of round.
  const [rounds, setRounds] = useState<RoundSummary[]>([])
  const [roundId, setRoundId] = useState<string>('')
  const [detail, setDetail] = useState<RoundDetail | null>(null)
  const [programme, setProgramme] = useState<string>('')

  useEffect(() => {
    fetch(`${API_BASE}/api/rounds`)
      .then((r) => r.json())
      .then((data: RoundSummary[]) => {
        setRounds(data)
        setRoundId((id) => id || (data[0]?.id ?? ''))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!roundId) return
    setDetail(null)
    fetch(`${API_BASE}/api/round/${roundId}`)
      .then((r) => r.json())
      .then((data: RoundDetail) => {
        setDetail(data)
        setProgramme(data.programmes?.[0]?.name ?? '')
      })
      .catch(() => {})
  }, [roundId])

  const parseError = useMemo(() => {
    if (!text.trim()) return 'Empty'
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'The body must be a JSON object — the payload is a flat map of your field names to values, with no envelope.'
      }
      if (Object.keys(parsed).length === 0) return 'The object is empty; the endpoint rejects that.'
      return null
    } catch (e) {
      return (e as Error).message
    }
  }, [text])

  function loadPreset(preset: Preset) {
    const json = JSON.stringify(preset.body, null, 2).split('{{programme}}').join(programme || '{{programme}}')
    setText(json)
    setEndpoint(preset.endpoint)
    setActivePreset(preset)
    setResult(null)
    setError(null)
  }

  async function send() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const data = await submitWithApiKey(endpoint, JSON.parse(text), apiKey)
      setResult(data as Record<string, unknown>)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="p-4">
        <SectionHeading hint="Each of these produces a specific outcome in the queues. Presets marked with a programme use whichever one you pick below.">
          Presets
        </SectionHeading>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => loadPreset(p)}
              title={p.expect}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                activePreset?.label === p.label
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {activePreset && (
          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            <span className="font-medium text-slate-700">Expect:</span> {activePreset.expect}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <SectionHeading hint="Only used to fill in a preset's programme name. The client a submission lands under is decided by the API key, not by this.">
          Aim at a real programme
        </SectionHeading>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-48 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Round</span>
            <select
              value={roundId}
              onChange={(e) => setRoundId(e.target.value)}
              className={inputClass}
            >
              {rounds.length === 0 && <option value="">No rounds found</option>}
              {rounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.client.name} — {r.name}
                  {r.closedAt && new Date(r.closedAt) < new Date() ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-48 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">Programme</span>
            <select
              value={programme}
              onChange={(e) => setProgramme(e.target.value)}
              className={inputClass}
            >
              {!detail && <option value="">Loading…</option>}
              {detail?.programmes?.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionHeading>Request body</SectionHeading>
          <div className="flex gap-1.5">
            {(['/api/apply', '/api/submit-report'] as Endpoint[]).map((ep) => (
              <button
                key={ep}
                type="button"
                onClick={() => setEndpoint(ep)}
                className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                  endpoint === ep
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                POST {ep}
              </button>
            ))}
          </div>
        </div>

        <p className="mb-2 text-xs leading-relaxed text-slate-500">
          The body <em>is</em> the payload: a flat object of the foundation's own field names to
          values, no envelope and no reserved keys. Values may be strings, numbers, or structured
          (a budget breakdown's line items).
        </p>

        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActivePreset(null)
          }}
          spellCheck={false}
          rows={18}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-slate-800 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={send}
            busy={busy}
            busyLabel="Sending"
            disabled={Boolean(parseError)}
          >
            Send
          </Button>
          <Button
            onClick={() => {
              try {
                setText(JSON.stringify(JSON.parse(text), null, 2))
              } catch {
                /* the parse error below already says so */
              }
            }}
            disabled={Boolean(parseError)}
          >
            Format
          </Button>
          {parseError ? (
            <span className="text-xs text-rose-600">Not valid: {parseError}</span>
          ) : (
            <span className="text-xs text-emerald-600">Valid JSON object</span>
          )}
        </div>
      </Card>

      {error && (
        <Callout tone="danger" title="Rejected at the door">
          {error}
        </Callout>
      )}

      {result && (
        <Callout tone="success" title="Accepted (202)">
          <p>
            The raw payload is stored and can no longer be lost. Mapping, scoring, due diligence and
            the deprivation lookup run in the background — the outcome shows up in the queue in a
            few seconds.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-white/60 px-2 py-1.5 font-mono text-[11px]">
            {JSON.stringify(result, null, 2)}
          </pre>
        </Callout>
      )}
    </div>
  )
}
