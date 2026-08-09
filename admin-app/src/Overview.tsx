// ─── Overview ────────────────────────────────────────────────────────────────
//
// The screen the app opens on, answering the question that actually brings anyone
// here: is anything stuck, and if so what kind of stuck. Previously the app opened
// on the raw review queue filtered to `needs_review`, which showed held applications
// and nothing else — a report waiting for a grant, or a submission whose background
// run had crashed, were both invisible until someone thought to go looking on
// another tab.
//
// Each card is a bucket, in the order you'd want to deal with them: things that are
// broken, then things that are waiting on a decision, then things that are fine.

import type { QueueFocus, View } from './App'
import { useQueues, type Buckets } from './queues'
import { Button, Callout, Card, Loading, Page, SectionHeading, STATUS_META } from './ui'
import type { IngestStatus } from './api'

interface BucketCard {
  key: string
  count: number
  label: string
  meaning: string
  tone: 'danger' | 'warn' | 'info' | 'calm'
  to?: { view: View; focus: QueueFocus }
}

const TONE_STYLES = {
  danger: 'border-rose-200 bg-rose-50/60 hover:border-rose-300',
  warn: 'border-amber-200 bg-amber-50/60 hover:border-amber-300',
  info: 'border-sky-200 bg-sky-50/60 hover:border-sky-300',
  calm: 'border-slate-200 bg-white hover:border-slate-300',
} as const

const TONE_NUMBER = {
  danger: 'text-rose-700',
  warn: 'text-amber-700',
  info: 'text-sky-700',
  calm: 'text-slate-400',
} as const

// Every card is one queue filter, so the number on it is exactly what you get when
// you click it. Zero-count cards are dropped rather than shown greyed: a wall of
// zeroes is what an operator learns to scan past, and the one card that isn't zero
// has to fight it for attention.
function cardsFor(b: Buckets): BucketCard[] {
  return [
    {
      key: 'stalled',
      count: b.stalled.length,
      label: 'Applications — processing crashed',
      meaning:
        'The background run died partway. Nothing was created and nothing was lost, but these will sit here forever unless someone presses Reprocess.',
      tone: 'danger',
      to: { view: 'applications', focus: 'stalled' },
    },
    {
      key: 'reports-stalled',
      count: b.reportsStalled.length,
      label: 'Reports — processing crashed',
      meaning:
        'Same again on the report side. There is no reprocess endpoint for reports, so these have to be mapped and matched by hand.',
      tone: 'danger',
      to: { view: 'reports', focus: 'stalled' },
    },
    {
      key: 'out-of-round',
      count: b.outOfRound.length,
      label: 'Nowhere to file them',
      meaning:
        'The programme these name does not exist for that foundation, or no round containing it is open. They cannot be resolved until the name or the round is fixed.',
      tone: 'warn',
      to: { view: 'applications', focus: 'out-of-round' },
    },
    {
      key: 'needs-mapping',
      count: b.needsMapping.length,
      label: 'Fields need mapping',
      meaning:
        'Something required could not be matched to an incoming field, both register numbers are missing, or a mapped value fails validation. A few clicks each, and teaching the lookup stops it recurring.',
      tone: 'warn',
      to: { view: 'applications', focus: 'held' },
    },
    {
      key: 'need-grant',
      count: b.reportsNeedGrant.length,
      label: 'Reports needing a grant',
      meaning:
        'A report is auto-linked only on an exact application-reference match. Everything else waits for a human to pick the grant — attaching one to the wrong grant ticks the wrong milestone.',
      tone: 'warn',
      to: { view: 'reports', focus: 'need-grant' },
    },
    {
      key: 'reports-mapping',
      count: b.reportsNeedsMapping.length,
      label: 'Reports needing mapping',
      meaning: 'Held on their fields rather than on the grant match.',
      tone: 'warn',
      to: { view: 'reports', focus: 'held' },
    },
    {
      key: 'confirm',
      count: b.awaitingConfirmation.length,
      label: 'AI mappings to confirm',
      meaning:
        'The application already exists — the model cleared the confidence threshold. These are here so a human agrees the mapping was right, and so the good ones can be taught to the lookup table.',
      tone: 'info',
      to: { view: 'applications', focus: 'confirm' },
    },
    {
      key: 'reports-confirm',
      count: b.reportsAwaitingConfirmation.length,
      label: 'Report mappings to confirm',
      meaning:
        'The submission exists and its milestone is ticked; the mapping still wants agreeing.',
      tone: 'info',
      to: { view: 'reports', focus: 'confirm' },
    },
  ]
}

/** Shown whatever the count, because "nothing is wrong, some things are in flight"
 *  is a different answer from "nothing is wrong" and an operator wants both. */
function processingCard(b: Buckets): BucketCard {
  return {
    key: 'processing',
    count: b.processing.length + b.reportsProcessing.length,
    label: 'Processing right now',
    meaning: 'Arrived in the last few minutes and moving through the pipeline. Nothing to do.',
    tone: 'calm',
  }
}

export function Overview({
  onNavigate,
}: {
  onNavigate: (view: View, focus?: QueueFocus) => void
}) {
  const { buckets, snapshot, loading, error, reload } = useQueues()
  const waiting = cardsFor(buckets).filter((c) => c.count > 0)
  const cards = [...waiting, processingCard(buckets)]

  return (
    <Page
      title="Overview"
      intro="Everything the pipeline could not finish on its own, grouped by what is actually wrong with it."
      actions={
        <>
          {snapshot && (
            <span className="text-xs text-slate-400">
              Updated {new Date(snapshot.loadedAt).toLocaleTimeString('en-GB')}
            </span>
          )}
          <Button onClick={reload} busy={loading} busyLabel="Refreshing">
            Refresh
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-5">
          <Callout tone="danger" title="Could not load the queues">
            {error}. If this is a 401, the VITE_ADMIN_TOKEN this app was built with does not match
            the backend's ADMIN_API_TOKEN.
          </Callout>
        </div>
      )}

      {loading && !snapshot && <Loading what="Loading queues" />}

      {snapshot && waiting.length === 0 && !error && (
        <div className="mb-8">
          <Callout tone="success" title="Nothing is waiting on you">
            Every submission that has arrived has been mapped and filed. Anything still processing
            is shown below.
          </Callout>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const clickable = Boolean(card.to) && card.count > 0
          return (
            <button
              key={card.key}
              type="button"
              disabled={!clickable}
              onClick={() => card.to && onNavigate(card.to.view, card.to.focus)}
              className={`rounded-xl border p-4 text-left transition-colors ${TONE_STYLES[card.tone]} ${
                clickable ? 'cursor-pointer' : 'cursor-default opacity-70'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-slate-800">{card.label}</span>
                <span className={`text-2xl font-semibold tabular-nums ${TONE_NUMBER[card.tone]}`}>
                  {card.count}
                </span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{card.meaning}</p>
              {clickable && (
                <span className="mt-2 inline-block text-xs font-medium text-indigo-600">
                  Open →
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-10">
        <SectionHeading hint="What each status on a submission means. The raw database value is in brackets — it is what appears in Workers Logs.">
          Status glossary
        </SectionHeading>
        <Card>
          <dl className="divide-y divide-slate-100">
            {(Object.keys(STATUS_META) as IngestStatus[]).map((status) => (
              <div key={status} className="grid gap-1 px-4 py-3 sm:grid-cols-4 sm:gap-4">
                <dt className="text-sm font-medium text-slate-800">
                  {STATUS_META[status].label}
                  <span className="ml-1.5 font-mono text-[11px] font-normal text-slate-400">
                    ({status})
                  </span>
                </dt>
                <dd className="text-xs leading-relaxed text-slate-500 sm:col-span-3">
                  {STATUS_META[status].meaning}
                </dd>
              </div>
            ))}
            <div className="grid gap-1 px-4 py-3 sm:grid-cols-4 sm:gap-4">
              <dt className="text-sm font-medium text-slate-800">
                Stalled
                <span className="ml-1.5 font-mono text-[11px] font-normal text-slate-400">
                  (received)
                </span>
              </dt>
              <dd className="text-xs leading-relaxed text-slate-500 sm:col-span-3">
                Not a real status — it is a <span className="font-mono">received</span> row that has
                sat unprocessed for over five minutes, which means the background run crashed.
                Shown separately because waiting will never fix it.
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-8">
        <SectionHeading>How a submission gets here</SectionHeading>
        <Card>
          <ol className="space-y-3 px-5 py-4 text-xs leading-relaxed text-slate-600">
            {[
              [
                'Arrives',
                'A foundation posts to /api/apply or /api/submit-report with their API key. The raw payload is stored immediately and acknowledged with 202 — from this point it can never be lost.',
              ],
              [
                'Mapped',
                'Their field names are matched to canonical fields: the foundation’s own lookup table first, then a built-in dictionary of common names, then an AI fallback for anything left.',
              ],
              [
                'Routed',
                'The programme name is matched to a programme in one of that foundation’s open rounds. No match, no round-programme to file it under.',
              ],
              [
                'Validated',
                'The assembled fields go through the same validators as a direct submission. A field can be mapped and still fail here — an amount that will not parse, a malformed sort code.',
              ],
              [
                'Promoted or held',
                'All clear: the application is created, scored, and screened for due diligence. Anything unresolved: held, and it shows up in these queues with the reason attached.',
              ],
            ].map(([step, detail], i) => (
              <li key={step} className="flex gap-3">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
                  {i + 1}
                </span>
                <span>
                  <span className="font-medium text-slate-800">{step}.</span> {detail}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </Page>
  )
}
