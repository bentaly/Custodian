// ─── Location probe ──────────────────────────────────────────────────────────
//
// Runs a delivery area through the real deprivation pipeline and shows every step.
//
// It exists because the failure that pipeline was rewritten for was INVISIBLE. A
// delivery area of "Preston" resolved to East Lothian and looked, on the application,
// exactly like a correct answer — no flag, no warning, just a confident decile — and
// so it sat in production for months. A wrong match and a right one are only
// distinguishable if you can see WHAT was matched and WHY that geography was chosen.
// So the steps are the screen here, and the decile is merely the last line.
//
// Read-only. It writes nothing and belongs to no application, so it is safe to point
// at production, which is usually where you want it — the whole point is to reproduce
// what a real foundation's text did.

import { useState } from 'react'
import { probeDeprivation, type ProbeResponse } from './api'
import { Button, Callout, Card, Page, SectionHeading, inputClass } from './ui'

/** Each one is a case the pipeline gets wrong in a different way, or used to. */
const EXAMPLES: Array<{ label: string; value: string; why: string }> = [
  { label: 'Preston', value: 'Preston', why: 'The homonym that shipped as East Lothian' },
  {
    label: 'Broadhurst Park, Manchester',
    value: 'Broadhurst Park, Manchester',
    why: 'A venue — the old gazetteer held none, so this matched nothing at all',
  },
  {
    label: 'Merseyside',
    value: 'Merseyside',
    why: 'A county: five districts, answered via its police force area',
  },
  {
    label: 'Birkenhead',
    value: 'Birkenhead',
    why: 'A town inside Wirral — reports its ward, not the whole district',
  },
  {
    label: 'Stockport',
    value: 'Stockport',
    why: 'A town that IS its district — reports all 191 neighbourhoods',
  },
  { label: 'EN6 1AE', value: 'EN6 1AE', why: 'A postcode: exact, and never calls Google' },
  {
    label: 'Buckinghamshire',
    value: 'Buckinghamshire',
    why: 'A county whose force ("Thames Valley") spans three — declines to guess',
  },
  {
    label: 'Nonsenseville',
    value: 'Nonsenseville',
    why: 'Not a place: partial-matches the whole UK and is refused',
  },
]

const LEVEL_MEANING: Record<string, string> = {
  ward: 'a ward — a neighbourhood-sized area',
  lad: 'a local authority district',
  pfa: 'a police force area, standing in for a county',
  region: 'a statistical region',
  too_broad: 'nothing — too broad to report',
}

export function LocationProbe() {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState<ProbeResponse | null>(null)

  async function run(location: string) {
    const trimmed = location.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      setProbe(await probeDeprivation(trimmed))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setProbe(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page
      title="Location probe"
      intro="Runs a delivery area through the real deprivation pipeline and shows every step — what Google matched, what kind of thing it is, which official area that justifies, and the decile that comes out. Writes nothing, and belongs to no application."
    >
      <Card className="mb-5 p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void run(input)
          }}
        >
          <label className="min-w-64 flex-1 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Delivery area</span>
            <input
              className={inputClass}
              placeholder="A postcode, a town, a venue, a county…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoFocus
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            busy={busy}
            busyLabel="Resolving…"
            disabled={!input.trim()}
          >
            Resolve
          </Button>
        </form>

        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Try one
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.value}
                type="button"
                title={ex.why}
                disabled={busy}
                onClick={() => {
                  setInput(ex.value)
                  void run(ex.value)
                }}
                className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-50"
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error && (
        <Callout tone="danger" title="Probe failed">
          {error}
        </Callout>
      )}

      {probe && <Trace probe={probe} />}
    </Page>
  )
}

function Trace({ probe }: { probe: ProbeResponse }) {
  const { google, area, level, result } = probe
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionHeading hint="Free text in, a place out. A postcode skips this entirely — and costs nothing.">
          1 · Google Geocoding
        </SectionHeading>
        {google == null ? (
          <p className="text-sm text-slate-600">
            <span className="font-medium text-emerald-700">Not called.</span> This is a postcode, so
            postcodes.io answers it exactly and for free.
          </p>
        ) : google.kind === 'unavailable' ? (
          <Callout tone="warn" title="Could not ask Google">
            {google.reason}. The application is left <code>pending</code> — meaning “not run yet”,
            not <code>unresolvable</code>, which would be a verdict on the applicant’s text.
          </Callout>
        ) : google.kind === 'no_match' ? (
          <p className="text-sm text-slate-600">
            Google found no such place. The application is marked <code>unresolvable</code>.
          </p>
        ) : (
          <div className="space-y-3">
            <Row label="Matched">
              <span className="font-medium text-slate-900">{google.name}</span>
            </Row>
            <Row label="Kind">
              <span className="flex flex-wrap gap-1">
                {google.types.map((t) => (
                  <code
                    key={t}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700"
                  >
                    {t}
                  </code>
                ))}
              </span>
            </Row>
            <Row label="Footprint">{google.extentKm} km across</Row>
            <Row label="Precision">
              <code className="text-[11px]">{google.locationType ?? '—'}</code>
              {google.partialMatch && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  partial match — Google matched only part of the text
                </span>
              )}
            </Row>
          </div>
        )}
      </Card>

      {area && (
        <Card className="p-5">
          <SectionHeading hint="Google returns places, never GSS codes — and GSS codes are the only thing our deprivation table joins on. This is the step that supplies them.">
            2 · postcodes.io
          </SectionHeading>
          <div className="space-y-3">
            <Row label="Ward">{area.wardName ?? '—'}</Row>
            <Row label="District">{area.ladName ?? '—'}</Row>
            <Row label="Force area">{area.pfa ?? '—'}</Row>
            <Row label="Region">{area.region ?? '—'}</Row>
            <Row label="Nation">{area.country ?? '—'}</Row>
          </div>
        </Card>
      )}

      {level && (
        <Card className="p-5">
          <SectionHeading hint="Chosen from what Google matched, not from how big its box is — the size rule reported Stockport's most deprived ward as the whole borough.">
            3 · Reporting level
          </SectionHeading>
          <p className="text-sm text-slate-700">
            <code className="rounded bg-indigo-50 px-1.5 py-0.5 font-medium text-indigo-700">
              {level}
            </code>
            <span className="ml-2 text-slate-500">— {LEVEL_MEANING[level] ?? level}</span>
          </p>
        </Card>
      )}

      <Card className="p-5">
        <SectionHeading hint="What the application would show.">4 · Result</SectionHeading>
        {result.status === 'resolved' ? (
          <div className="space-y-3">
            <p className="text-lg font-semibold tracking-tight text-slate-900">
              {result.min === result.max
                ? `Decile ${result.min}`
                : `Decile ${result.min}–${result.max}`}
              <span className="ml-2 text-sm font-normal text-slate-500">
                typically {result.median}
              </span>
            </p>
            <Row label="Area">
              {result.areaName} <span className="text-slate-400">· {result.areaType}</span>
            </Row>
            <Row label="Built from">{result.count.toLocaleString()} neighbourhoods</Row>
            <Row label="Index">
              {result.vintage} <span className="text-slate-400">· {result.nation}</span>
            </Row>
            <Histogram histogram={result.histogram} />
          </div>
        ) : result.status === 'too_broad' ? (
          <Callout tone="warn" title="Too broad to report">
            Matched “{result.matchedName}”, {result.extentKm.toFixed(1)} km across. A single decile
            would mislead, so nothing is claimed.
          </Callout>
        ) : result.status === 'unresolvable' ? (
          <Callout tone="warn" title="Unresolvable">
            No place matched this text. Shown on the application as a blank rather than a guess.
          </Callout>
        ) : (
          <Callout tone="info" title="Pending">
            Nothing was attempted — either there is no delivery area, or the geocoder could not be
            reached. A re-run picks it up.
          </Callout>
        )}
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="w-24 shrink-0 text-xs font-medium text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-700">{children}</span>
    </div>
  )
}

/** Decile 1 (most deprived) on the left through 10 on the right. */
function Histogram({ histogram }: { histogram: number[] }) {
  const peak = Math.max(1, ...histogram)
  return (
    <div className="pt-2">
      <p className="mb-1.5 text-xs font-medium text-slate-500">Spread across deciles</p>
      <div className="flex items-end gap-1" style={{ height: 56 }}>
        {histogram.map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div
              title={`Decile ${i + 1}: ${n} neighbourhood${n === 1 ? '' : 's'}`}
              className={`w-full rounded-sm ${n ? 'bg-indigo-500' : 'bg-slate-100'}`}
              style={{ height: `${Math.max(n ? 3 : 1, (n / peak) * 40)}px` }}
            />
            <span className="text-[10px] text-slate-400">{i + 1}</span>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">1 = most deprived 10% · 10 = least</p>
    </div>
  )
}
