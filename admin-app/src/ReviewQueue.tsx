import { useEffect, useMemo, useState } from 'react'
import {
  adminGet,
  adminPost,
  externalIdOf,
  useCanonicalFields,
  type CanonicalField,
  type IngestRow,
} from './api'

type StatusFilter = 'needs_review' | 'ai_proposed' | 'complete' | 'all'

const STATUS_STYLES: Record<IngestRow['status'], string> = {
  needs_review: 'border-amber-200 bg-amber-50 text-amber-800',
  ai_proposed: 'border-blue-200 bg-blue-50 text-blue-700',
  complete: 'border-green-200 bg-green-50 text-green-800',
}

export function ReviewQueue() {
  const [status, setStatus] = useState<StatusFilter>('needs_review')
  const [rows, setRows] = useState<IngestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canonicalFields = useCanonicalFields()

  function load() {
    setLoading(true)
    setError(null)
    const q = status === 'all' ? '' : `?status=${status}`
    adminGet<IngestRow[]>(`/api/admin/ingests${q}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [status])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['needs_review', 'ai_proposed', 'complete', 'all'] as StatusFilter[]).map((s) => (
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
        <IngestCard key={row.id} row={row} canonicalFields={canonicalFields} onResolved={load} />
      ))}
    </div>
  )
}

function IngestCard({
  row,
  canonicalFields,
  onResolved,
}: {
  row: IngestRow
  canonicalFields: CanonicalField[]
  onResolved: () => void
}) {
  const [open, setOpen] = useState(row.status === 'needs_review')
  const payloadKeys = useMemo(() => Object.keys(row.rawPayload), [row.rawPayload])

  // Invert the stored resolved map (sourceKey → canonical) to canonical → sourceKey.
  const resolvedByCanonical = useMemo(() => {
    const m: Record<string, string> = {}
    for (const [src, canon] of Object.entries(row.resolved ?? {})) m[canon] = src
    return m
  }, [row.resolved])

  // Chosen source key per canonical field: stored resolution, else AI proposal. Seeded
  // here and topped up when the canonical registry arrives (it may load after mount).
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
  const [err, setErr] = useState<string | null>(null)

  async function resolve() {
    setSaving(true)
    setErr(null)
    try {
      const cleanMapping: Record<string, string> = {}
      for (const [k, v] of Object.entries(mapping)) if (v) cleanMapping[k] = v
      await adminPost(`/api/admin/ingests/${row.id}/resolve`, {
        mapping: cleanMapping,
        addToLookup: Object.keys(addToLookup).filter((k) => addToLookup[k] && mapping[k]),
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
            <span className="ml-2 text-gray-400">{externalIdOf(row) ?? '(no ext id)'}</span>
          </p>
          <p className="text-xs text-gray-400">{new Date(row.createdAt).toLocaleString('en-GB')}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}>
          {row.status.replace('_', ' ')}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-100 px-4 py-4">
          {row.status === 'complete' ? (
            <p className="text-xs text-gray-500">
              Resolved → application {row.applicationId}. Mapping shown for reference.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Map each required field to an incoming value, then resolve to create the application.
              Tick “add to lookup” to teach the foundation’s table.
            </p>
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

          {err && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

          {row.status !== 'complete' && (
            <button
              onClick={resolve}
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Resolving…' : 'Resolve → create application'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
