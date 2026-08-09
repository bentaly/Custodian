// ─── Testing ─────────────────────────────────────────────────────────────────
//
// The four test submitters used to sit in the top nav as peers of the review queue,
// which made an operational tool look like it was mostly a test harness, and gave no
// clue that they all hit the same two endpoints. They are one section now, with the
// API key lifted out of each of them: the key was a separate box on three screens,
// each reading the same localStorage entry, each looking like it wanted a different
// value.

import { useState } from 'react'
import { Submitter } from './Submitter'
import { Submitter7Stars } from './Submitter7Stars'
import { SubmitterReport } from './SubmitterReport'
import { SubmitterJson } from './SubmitterJson'
import { DEFAULT_APPLY_API_KEY, useApplyApiKey } from './api'
import { Callout, Card, Page, SectionHeading, inputClass } from './ui'

type Tab = 'json' | 'form' | '7stars' | 'report'

const TABS: Array<{ key: Tab; label: string; blurb: string }> = [
  {
    key: 'json',
    label: 'Raw JSON',
    blurb:
      'Post any body you like to either endpoint. Presets reproduce each way a submission can end up held, so you can practise clearing them.',
  },
  {
    key: 'form',
    label: 'Application form',
    blurb:
      'A generic application form built from the selected programme’s own questions, with quick-fill presets for each due diligence outcome.',
  },
  {
    key: '7stars',
    label: '7stars form',
    blurb: 'A replica of a real foundation’s form, field names and all — the mapper’s hard case.',
  },
  {
    key: 'report',
    label: 'Grant report',
    blurb: 'Posts to /api/submit-report, exercising the grant-matching side of the pipeline.',
  },
]

export function TestSubmissions() {
  const [tab, setTab] = useState<Tab>('json')
  const [apiKey, setApiKey] = useApplyApiKey()
  const current = TABS.find((t) => t.key === tab)!
  const usingDefault = Boolean(DEFAULT_APPLY_API_KEY) && apiKey === DEFAULT_APPLY_API_KEY

  return (
    <Page
      title="Send test data"
      intro="Everything here posts to the real public endpoints on the backend this app is built against — the same path a foundation's integration takes. Submissions land in the queues like any other."
    >
      <div className="mb-5">
        <Card className="p-4">
          <SectionHeading hint="Sent as Authorization: Bearer …, and it is the key — not anything in the body — that decides which foundation a submission belongs to.">
            API key
          </SectionHeading>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="cust_sk_…"
            className={`${inputClass} max-w-md font-mono`}
          />
          <p className="mt-1.5 text-xs text-slate-500">
            {usingDefault ? (
              <>
                Using the key baked in at build time (
                <span className="font-mono">VITE_APPLY_API_KEY</span>). Type here to override it for
                this browser; clear the box to go back to the built-in one.
              </>
            ) : apiKey ? (
              <>
                Stored in this browser only. Generate keys in the main app under{' '}
                <strong>Settings → API keys</strong>.
              </>
            ) : (
              <>
                No key set. Generate one in the main app under{' '}
                <strong>Settings → API keys</strong>, or put one in{' '}
                <span className="font-mono">admin-app/.env.local</span> as{' '}
                <span className="font-mono">VITE_APPLY_API_KEY</span> so it is always here.
              </>
            )}
          </p>
          {!apiKey && (
            <div className="mt-3">
              <Callout tone="warn">
                Without a key every submission below comes back 401. The key is shared by all four
                tabs and by Edit &amp; resend in the queues.
              </Callout>
            </div>
          )}
        </Card>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-5 max-w-3xl text-xs leading-relaxed text-slate-500">{current.blurb}</p>

      {tab === 'json' && <SubmitterJson />}
      {tab === 'form' && <Submitter />}
      {tab === '7stars' && <Submitter7Stars />}
      {tab === 'report' && <SubmitterReport />}
    </Page>
  )
}
