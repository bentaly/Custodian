import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Button, Select } from '../ui'
import { C } from '../ui/tokens'
import { withAlpha } from '../BarMeter'
import { listUnplaced, placeSubmission } from '../../server/fns/unplaced'
import { fmtAmount, fmtDate } from '../../lib/format'

// "2 submissions to Summer 2026 need a programme." Submissions that arrived during this
// round but did not say which programme they were for, or named one the foundation
// does not run. Until someone places them they are in no round at all, so they are
// counted nowhere; this banner is the only place they appear in the app.
//
// Admins only (placing is a change to the application), and fetched after the page
// renders rather than in the loader: nearly every round has none, and the list must not
// wait on a check that almost always comes back empty.

type Unplaced = Awaited<ReturnType<typeof listUnplaced>>

export function UnplacedBanner({ roundId, roundName }: { roundId: string; roundName: string }) {
  const router = useRouter()
  const [data, setData] = useState<Unplaced | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [placed, setPlaced] = useState<Array<{ name: string; applicationId: string }>>([])

  useEffect(() => {
    let live = true
    setData(null)
    setPlaced([])
    listUnplaced({ data: { roundId } })
      .then((d) => {
        if (!live) return
        setData(d)
        setChoice(
          Object.fromEntries(
            d.rows
              .filter((r) => r.suggestedRoundProgrammeId)
              .map((r) => [r.ingestId, r.suggestedRoundProgrammeId!]),
          ),
        )
      })
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [roundId])

  if (!data || (data.rows.length === 0 && placed.length === 0)) return null

  async function place(ingestId: string, name: string) {
    const rp = choice[ingestId]
    if (!rp) return
    setBusy(ingestId)
    setError(null)
    try {
      const { applicationId } = await placeSubmission({ data: { ingestId, roundProgrammeId: rp } })
      setData((d) => (d ? { ...d, rows: d.rows.filter((r) => r.ingestId !== ingestId) } : d))
      setPlaced((p) => [...p, { name, applicationId }])
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  const n = data.rows.length
  const options = data.programmes.map((p) => ({ value: p.roundProgrammeId, label: p.name }))

  return (
    <section
      aria-label="Submissions that need a programme"
      className="overflow-hidden rounded-card border"
      style={{
        borderColor: withAlpha(C.warning, 0.25),
        backgroundColor: withAlpha(C.warning, 0.04),
      }}
    >
      <div className="flex flex-col gap-0.5 px-4 py-3.5">
        <p className="font-display text-body font-medium" style={{ color: C.ink }}>
          {n > 0
            ? `${n} submission${n === 1 ? '' : 's'} to ${roundName} need${n === 1 ? 's' : ''} a programme`
            : 'All placed'}
        </p>
        {n > 0 && (
          <p className="font-display text-label" style={{ color: C.sub }}>
            They arrived during this round but did not say which programme they were for, or named
            one you do not run. They are not counted anywhere until you place them.
          </p>
        )}
        {placed.length > 0 && (
          <p className="font-display text-label" style={{ color: C.body }}>
            Placed:{' '}
            {placed.map((p, i) => (
              <span key={p.applicationId}>
                {i > 0 && ', '}
                <Link
                  to="/applications/$applicationId"
                  params={{ applicationId: p.applicationId }}
                  className="underline"
                  style={{ color: C.brand }}
                >
                  {p.name}
                </Link>
              </span>
            ))}
            . Anything else they are missing is flagged on the application.
          </p>
        )}
      </div>
      {n > 0 && (
        <div className="bg-white">
          {data.rows.map((r) => (
            <div
              key={r.ingestId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3"
              style={{ borderColor: C.line }}
            >
              <div className="min-w-[220px] flex-1">
                <p className="font-display text-body font-medium" style={{ color: C.ink }}>
                  {r.organisationName}
                </p>
                <p className="font-display text-label" style={{ color: C.sub }}>
                  Received {fmtDate(r.receivedAt)} ·{' '}
                  {r.programmeWritten ? `they wrote "${r.programmeWritten}"` : 'no programme given'}
                </p>
              </div>
              <span className="w-24 font-display text-body tabular-nums" style={{ color: C.ink }}>
                {fmtAmount(r.amount?.replace(/[^0-9.]/g, '') ?? null)}
              </span>
              <div className="w-56">
                <Select
                  aria-label={`Programme for ${r.organisationName}`}
                  value={choice[r.ingestId] ?? ''}
                  options={options}
                  placeholder="Choose programme"
                  onChange={(v: string) => setChoice((c) => ({ ...c, [r.ingestId]: v }))}
                />
              </div>
              <Button
                size="sm"
                disabled={!choice[r.ingestId] || busy !== null}
                onClick={() => place(r.ingestId, r.organisationName)}
              >
                {busy === r.ingestId ? 'Placing…' : 'Place'}
              </Button>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p
          className="border-t bg-white px-4 py-2 font-display text-label"
          style={{ borderColor: C.line, color: C.danger }}
          role="alert"
        >
          {error}
        </p>
      )}
    </section>
  )
}
