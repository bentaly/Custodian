import { useEffect, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Button, Select } from '../ui'
import { C } from '../ui/tokens'
import { withAlpha } from '../BarMeter'
import {
  attachHeldReport,
  dismissHeldReport,
  listHeldReports,
  type GrantChoice,
} from '../../server/fns/heldReports'
import { fmtDate, fmtMoney } from '../../lib/format'

// "2 reports need a grant." Reports that arrived without a reference we could match to
// exactly one grant. The foundation knows which grant a grantee was reporting on, so they
// attach it here; until then the report is in no grant's timeline and ticks nothing.
//
// The pipeline's ranked suggestions come first, each with why it was suggested, and any
// grant can be chosen instead. Nothing is pre-selected: a report on the wrong grant says
// a grantee reported when they have not, so the choice is always a person's.
//
// Admins only, and fetched after the page renders: nearly always there are none.

type Held = Awaited<ReturnType<typeof listHeldReports>>

const grantLabel = (g: GrantChoice) =>
  [g.organisationName, g.programmeName, fmtMoney(g.amountAwarded), g.reference]
    .filter(Boolean)
    .join(' · ')

export function HeldReportsPanel() {
  const router = useRouter()
  const [data, setData] = useState<Held | null>(null)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [confirmingDismiss, setConfirmingDismiss] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attached, setAttached] = useState<Array<{ name: string; reportId: string }>>([])

  useEffect(() => {
    let live = true
    listHeldReports()
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
    return () => {
      live = false
    }
  }, [])

  if (!data || (data.reports.length === 0 && attached.length === 0)) return null

  const remove = (ingestId: string) =>
    setData((d) => (d ? { ...d, reports: d.reports.filter((r) => r.ingestId !== ingestId) } : d))

  async function attach(ingestId: string, name: string) {
    const awardId = choice[ingestId]
    if (!awardId) return
    setBusy(ingestId)
    setError(null)
    try {
      const { reportId } = await attachHeldReport({ data: { ingestId, awardId } })
      remove(ingestId)
      setAttached((a) => [...a, { name, reportId }])
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  async function dismiss(ingestId: string) {
    setBusy(ingestId)
    setError(null)
    try {
      await dismissHeldReport({ data: { ingestId } })
      remove(ingestId)
      setConfirmingDismiss(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  const n = data.reports.length
  const allOptions = data.grants.map((g) => ({ value: g.awardId, label: grantLabel(g) }))

  return (
    <section
      aria-label="Reports that need a grant"
      className="overflow-hidden rounded-card border"
      style={{
        borderColor: withAlpha(C.warning, 0.25),
        backgroundColor: withAlpha(C.warning, 0.04),
      }}
    >
      <div className="flex flex-col gap-0.5 px-4 py-3.5">
        <p className="font-display text-body font-medium" style={{ color: C.ink }}>
          {n > 0
            ? `${n} report${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} a grant`
            : 'All attached'}
        </p>
        {n > 0 && (
          <p className="font-display text-label" style={{ color: C.sub }}>
            They arrived without a reference that matched one of your grants. Choose the grant each
            is about; until then it ticks no reporting milestone.
          </p>
        )}
        {attached.length > 0 && (
          <p className="font-display text-label" style={{ color: C.body }}>
            Attached:{' '}
            {attached.map((a, i) => (
              <span key={a.reportId}>
                {i > 0 && ', '}
                <Link
                  to="/reports/$reportKey"
                  params={{ reportKey: a.reportId }}
                  className="underline"
                  style={{ color: C.brand }}
                >
                  {a.name}
                </Link>
              </span>
            ))}
            . The AI analysis is running; it usually takes under a minute.
          </p>
        )}
      </div>

      {data.reports.map((r) => {
        const name = r.organisationName ?? 'No organisation name given'
        const chosen = choice[r.ingestId] ?? ''
        const inSuggestions = r.suggestions.some((s) => s.awardId === chosen)
        return (
          <div
            key={r.ingestId}
            className="flex flex-col gap-3 border-t bg-white px-4 py-3.5"
            style={{ borderColor: C.line }}
          >
            <div className="flex flex-col gap-0.5">
              <p className="font-display text-body font-medium" style={{ color: C.ink }}>
                {name}
              </p>
              <p className="font-display text-label" style={{ color: C.sub }}>
                Received {fmtDate(r.receivedAt)} ·{' '}
                {r.reference
                  ? `their reference "${r.reference}" matches none of your grants`
                  : 'no reference given'}
              </p>
              {r.summary && (
                <p className="mt-1 line-clamp-2 font-display text-label" style={{ color: C.body }}>
                  {r.summary}
                </p>
              )}
            </div>

            {r.suggestions.length > 0 && (
              <div
                className="flex flex-col gap-1.5"
                role="radiogroup"
                aria-label={`Grant for ${name}`}
              >
                <p className="font-display text-label font-medium" style={{ color: C.sub }}>
                  Likely grants
                </p>
                {r.suggestions.map((s) => (
                  <label
                    key={s.awardId}
                    className="flex cursor-pointer items-start gap-2.5 rounded-chip border px-3 py-2"
                    style={{
                      borderColor: chosen === s.awardId ? C.brand : C.line,
                      backgroundColor: chosen === s.awardId ? C.brandWash : C.white,
                    }}
                  >
                    <input
                      type="radio"
                      name={`grant-${r.ingestId}`}
                      className="mt-1"
                      checked={chosen === s.awardId}
                      onChange={() => setChoice((c) => ({ ...c, [r.ingestId]: s.awardId }))}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="font-display text-body" style={{ color: C.ink }}>
                        {grantLabel(s)}
                      </span>
                      <span className="font-display text-label" style={{ color: C.sub }}>
                        Awarded {fmtDate(s.awardedOn)} · {s.reasons.join(', ')}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full max-w-md">
                <Select
                  aria-label={`Choose any grant for ${name}`}
                  value={inSuggestions ? '' : chosen}
                  options={allOptions}
                  placeholder={
                    r.suggestions.length > 0 ? 'Or choose another grant' : 'Choose the grant'
                  }
                  onChange={(v: string) => setChoice((c) => ({ ...c, [r.ingestId]: v }))}
                />
              </div>
              <Button
                size="sm"
                disabled={!chosen || busy !== null}
                onClick={() => attach(r.ingestId, name)}
              >
                {busy === r.ingestId ? 'Attaching…' : 'Attach'}
              </Button>
              <div className="ml-auto">
                {confirmingDismiss === r.ingestId ? (
                  <span
                    className="flex items-center gap-2 font-display text-label"
                    style={{ color: C.sub }}
                  >
                    Set it aside as not a report on any of your grants?
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={busy !== null}
                      onClick={() => dismiss(r.ingestId)}
                    >
                      Set aside
                    </Button>
                    <Button variant="text" size="xs" onClick={() => setConfirmingDismiss(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button variant="text" size="xs" onClick={() => setConfirmingDismiss(r.ingestId)}>
                    Not one of ours
                  </Button>
                )}
              </div>
            </div>
          </div>
        )
      })}

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
