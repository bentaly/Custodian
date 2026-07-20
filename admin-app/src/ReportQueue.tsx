import { useEffect, useMemo, useState } from 'react'
import {
  adminDelete,
  adminGet,
  adminPost,
  useReportCanonicalFields,
  type CanonicalField,
  type GrantOption,
  type ReportIngestRow,
} from './api'

// The review queue for incoming grant reports. Two things can hold a report:
// unmapped required fields (same as applications) and — unique to reports — no
// grant match (auto-linking only happens on an exact externalApplicationId hit;
// everything else waits here for a human to pick from the ranked candidates).

type StatusFilter = 'needs_review' | 'ai_proposed' | 'complete' | 'received' | 'all'

const STATUS_STYLES: Record<ReportIngestRow['status'], string> = {
  received: 'border-gray-200 bg-gray-50 text-gray-500',
  needs_review: 'border-amber-200 bg-amber-50 text-amber-800',
  ai_proposed: 'border-blue-200 bg-blue-50 text-blue-700',
  complete: 'border-green-200 bg-green-50 text-green-800',
}

export function ReportQueue() {
  const [status, setStatus] = useState<StatusFilter>('needs_review')
  const [rows, setRows] = useState<ReportIngestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canonicalFields = useReportCanonicalFields()

  function load() {
    setLoading(true)
    setError(null)
    const q = status === 'all' ? '' : `?status=${status}`
    adminGet<ReportIngestRow[]>(`/api/admin/report-ingests${q}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [status])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['needs_review', 'ai_proposed', 'complete', 'received', 'all'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                status === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">Error: {error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="rounded-lg bg-white p-8 text-center text-sm text-gray-400 ring-1 ring-gray-200">
          Nothing here.
        </p>
      )}

      {rows.map((row) => (
        <ReportCard key={row.id} row={row} canonicalFields={canonicalFields} onResolved={load} />
      ))}
    </div>
  )
}

function organisationOf(row: ReportIngestRow): string | null {
  const entry = Object.entries(row.resolved ?? {}).find(
    ([, canonical]) => canonical === 'organisationName',
  )
  if (!entry) return null
  const value = row.rawPayload[entry[0]]
  return value == null || value === '' ? null : String(value)
}

function ReportCard({
  row,
  canonicalFields,
  onResolved,
}: {
  row: ReportIngestRow
  canonicalFields: CanonicalField[]
  onResolved: () => void
}) {
  const [open, setOpen] = useState(row.status === 'needs_review')
  const payloadKeys = useMemo(() => Object.keys(row.rawPayload), [row.rawPayload])

  const resolvedByCanonical = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [src, canon] of Object.entries(row.resolved ?? {})) m[canon] = src
    return m
  }, [row.resolved])

  const [mapping, setMapping] = useState<Record<string, string>>({})
  useEffect(() => {
    setMapping((prev) => {
      let changed = false
      const next = { ...prev }
      for (const f of canonicalFields) {
        if (next[f.key] === undefined) {
          next[f.key] = resolvedByCanonical[f.key] ?? row.proposed?.[f.key]?.sourceKey ?? ''
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [canonicalFields, resolvedByCanonical, row.proposed])
  const [addToLookup, setAddToLookup] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Grant matching: load the client's grants when the card opens (once), pre-select
  // the top-ranked candidate.
  const [grants, setGrants] = useState<GrantOption[] | null>(null)
  const [grantId, setGrantId] = useState<string>(row.matchCandidates?.[0]?.grantId ?? '')
  const needsMatch = row.status !== 'complete' && !row.reportId
  useEffect(() => {
    if (!open || !needsMatch || grants) return
    adminGet<GrantOption[]>(`/api/admin/awards?clientId=${row.client.id}`)
      .then(setGrants)
      .catch((e: Error) => setErr(e.message))
  }, [open, needsMatch, grants, row.client.id])

  const candidateById = useMemo(() => {
    const m = new Map<string, { score: number; reasons: string[] }>()
    for (const c of row.matchCandidates ?? []) m.set(c.grantId, c)
    return m
  }, [row.matchCandidates])

  // Candidates first (in rank order), then the rest of the client's grants.
  const orderedGrants = useMemo(() => {
    if (!grants) return []
    return [...grants].sort((a, b) => {
      const ca = candidateById.get(a.id)?.score ?? -1
      const cb = candidateById.get(b.id)?.score ?? -1
      return cb - ca
    })
  }, [grants, candidateById])

  const mappedKeys = canonicalFields.map((f) => f.key).filter((k) => mapping[k])
  const allTicked = mappedKeys.length > 0 && mappedKeys.every((k) => addToLookup[k])
  function toggleAllLookups() {
    setAddToLookup(Object.fromEntries(mappedKeys.map((k) => [k, !allTicked])))
  }

  async function remove() {
    const msg =
      row.status === 'received'
        ? 'This row may still be processing — deleting now can leave an orphaned report. Delete anyway?'
        : row.reportId
          ? 'Delete this report AND its submission (the reporting milestone it ticked will reopen)?'
          : 'Delete this report?'
    if (!window.confirm(msg)) return
    setDeleting(true)
    setErr(null)
    try {
      await adminDelete(`/api/admin/report-ingests/${row.id}`)
      onResolved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  async function resolve() {
    setSaving(true)
    setErr(null)
    try {
      if (needsMatch && !grantId) throw new Error('Pick the grant this report belongs to')
      const cleanMapping: Record<string, string> = {}
      for (const [k, v] of Object.entries(mapping)) if (v) cleanMapping[k] = v
      await adminPost(`/api/admin/report-ingests/${row.id}/resolve`, {
        mapping: cleanMapping,
        addToLookup: Object.keys(addToLookup).filter((k) => addToLookup[k] && mapping[k]),
        grantId: grantId || row.matchCandidates?.[0]?.grantId,
      })
      onResolved()
    } catch (e) {
      const fields = (e as { fields?: Array<{ field: string; message: string }> }).fields
      setErr(
        fields?.length
          ? `${(e as Error).message}: ${fields.map((f) => `${f.field} (${f.message})`).join(', ')}`
          : (e as Error).message,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg bg-white ring-1 ring-gray-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {row.client.name}
            <span className="ml-2 text-gray-400">{organisationOf(row) ?? '(unmapped org)'}</span>
          </p>
          <p className="text-xs text-gray-400">{new Date(row.createdAt).toLocaleString('en-GB')}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
          {row.status.replace('_', ' ')}
        </span>
      </button>

      {open && row.status === 'received' && (
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-4">
          <p className="text-xs text-gray-500">
            Processing — mapping, grant matching and AI analysis are running in the background.
            Refresh in a minute; a row stuck here means the pipeline crashed.
          </p>
          <DeleteButton onClick={remove} deleting={deleting} />
        </div>
      )}

      {open && row.status !== 'received' && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4">
          {row.status === 'complete' ? (
            <p className="text-xs text-gray-500">
              Resolved → report submission {row.reportId}. Mapping shown for reference.
            </p>
          ) : row.reportId ? (
            <p className="text-xs text-gray-500">
              The report was already created from the AI-proposed mapping (submission{' '}
              {row.reportId}). Review the mapping below, tick “lookup” for anything worth
              teaching, then confirm.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Map each required field, pick the grant this report belongs to, then resolve. Tick
              “add to lookup” to teach the foundation’s report-field table.
            </p>
          )}

          {row.status !== 'complete' && mappedKeys.length > 0 && (
            <button
              type="button"
              onClick={toggleAllLookups}
              className="text-xs text-indigo-600 hover:text-indigo-800"
            >
              {allTicked ? 'Untick all lookups' : 'Tick all lookups'}
            </button>
          )}

          <div className="space-y-2">
            {canonicalFields.map((f) => {
              const chosen = mapping[f.key] ?? ''
              const proposal = row.proposed?.[f.key]
              const preview = chosen ? String(row.rawPayload[chosen] ?? '') : ''
              return (
                <div key={f.key} className="grid grid-cols-12 items-center gap-2">
                  <label className="col-span-3 text-xs font-medium text-gray-700">
                    {f.label}
                    {f.required && <span className="ml-0.5 text-red-500">*</span>}
                  </label>
                  <select
                    disabled={row.status === 'complete'}
                    value={chosen}
                    onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                    className="col-span-4 rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-50"
                  >
                    <option value="">— none —</option>
                    {payloadKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <span className="col-span-3 truncate text-xs text-gray-500" title={preview}>
                    {preview}
                  </span>
                  <div className="col-span-2 flex items-center gap-1 text-xs">
                    {proposal?.sourceKey && (
                      <span
                        className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-600"
                        title={`AI suggested “${proposal.sourceKey}”`}
                      >
                        AI {Math.round(proposal.confidence * 100)}%
                      </span>
                    )}
                    {row.status !== 'complete' && chosen && (
                      <label className="flex items-center gap-1 text-gray-500">
                        <input
                          type="checkbox"
                          checked={Boolean(addToLookup[f.key])}
                          onChange={(e) =>
                            setAddToLookup((s) => ({ ...s, [f.key]: e.target.checked }))
                          }
                        />
                        lookup
                      </label>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {needsMatch && (
            <div className="space-y-2 rounded-md bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-700">
                Which grant is this report for?
                {row.matchCandidates?.length
                  ? ' Suggested matches first.'
                  : ' No confident suggestions — pick from all grants.'}
              </p>
              {!grants && <p className="text-xs text-gray-400">Loading grants…</p>}
              {grants && grants.length === 0 && (
                <p className="text-xs text-gray-500">
                  This foundation has no grants on record yet — the report stays held until its
                  grant is created or imported.
                </p>
              )}
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {orderedGrants.map((g) => {
                  const cand = candidateById.get(g.id)
                  return (
                    <label
                      key={g.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${
                        grantId === g.id ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`grant-${row.id}`}
                        checked={grantId === g.id}
                        onChange={() => setGrantId(g.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-gray-800">
                          {g.organisationName ?? '(direct grant)'}
                        </span>{' '}
                        <span className="text-gray-500">
                          £{Number(g.amountAwarded).toLocaleString('en-GB')}
                          {g.programmeName ? ` · ${g.programmeName}` : ''} ·{' '}
                          {new Date(g.decisionAt).toLocaleDateString('en-GB')} · reports{' '}
                          {g.totalMilestones - g.openMilestones}/{g.totalMilestones}
                        </span>
                        {cand && (
                          <span className="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                            {cand.reasons.join(' · ')}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

          <div className="flex items-center justify-between gap-3">
            {row.status !== 'complete' ? (
              <button
                onClick={resolve}
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving
                  ? row.reportId
                    ? 'Confirming…'
                    : 'Resolving…'
                  : row.reportId
                    ? 'Confirm mapping'
                    : 'Resolve → create report'}
              </button>
            ) : (
              <span />
            )}
            <DeleteButton onClick={remove} deleting={deleting} />
          </div>
        </div>
      )}
    </div>
  )
}

function DeleteButton({ onClick, deleting }: { onClick: () => void; deleting: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deleting}
      className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-500 hover:border-red-300 hover:text-red-600 disabled:opacity-60"
    >
      {deleting ? 'Deleting…' : 'Delete'}
    </button>
  )
}
