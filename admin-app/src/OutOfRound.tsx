import { useEffect, useState } from 'react'
import { adminDelete, adminGet, API_BASE, externalIdOf, type IngestRow } from './api'

// Ingests held because their programme name didn't match a programme in any open
// round (roundProgrammeId is null). Staff can edit the raw data — typically fix the
// programme name — and resend it through /api/apply, or dismiss it.
export function OutOfRound() {
  const [rows, setRows] = useState<IngestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    adminGet<IngestRow[]>('/api/admin/ingests?status=needs_review')
      .then((rs) => setRows(rs.filter((r) => r.roundProgrammeId == null)))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <p className="text-sm text-gray-500">
        Submissions held because their programme name didn’t match an open round. Fix the data
        and resend, or dismiss.
      </p>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">Error: {error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="rounded-lg bg-white p-8 text-center text-sm text-gray-400 ring-1 ring-gray-200">
          Nothing out of round.
        </p>
      )}
      {rows.map((row) => (
        <UnroutedCard key={row.id} row={row} onChanged={load} />
      ))}
    </div>
  )
}

function UnroutedCard({ row, onChanged }: { row: IngestRow; onChanged: () => void }) {
  const [fields, setFields] = useState(() =>
    Object.entries(row.rawPayload).map(([key, value]) => ({ key, value: String(value ?? '') })),
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const update = (i: number, k: 'key' | 'value', val: string) =>
    setFields((f) => f.map((row, idx) => (idx === i ? { ...row, [k]: val } : row)))
  const removeRow = (i: number) => setFields((f) => f.filter((_, idx) => idx !== i))
  const addRow = () => setFields((f) => [...f, { key: '', value: '' }])

  async function resend() {
    setBusy(true)
    setErr(null)
    try {
      const payload = Object.fromEntries(
        fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value]),
      )
      const res = await fetch(`${API_BASE}/api/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      // Resend created a fresh ingest — remove this stale held one.
      await adminDelete(`/api/admin/ingests/${row.id}`)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function dismiss() {
    setBusy(true)
    setErr(null)
    try {
      await adminDelete(`/api/admin/ingests/${row.id}`)
      onChanged()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">
          {row.client.name}
          <span className="ml-2 text-gray-400">{externalIdOf(row) ?? '(no ext id)'}</span>
        </p>
        <span className="text-xs text-gray-400">{new Date(row.createdAt).toLocaleString('en-GB')}</span>
      </div>

      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={f.key}
              onChange={(e) => update(i, 'key', e.target.value)}
              className="w-1/3 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs"
            />
            <input
              value={f.value}
              onChange={(e) => update(i, 'value', e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
            <button
              onClick={() => removeRow(i)}
              className="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-400 hover:border-red-300 hover:text-red-500"
            >
              ✕
            </button>
          </div>
        ))}
        <button onClick={addRow} className="text-xs text-indigo-600 hover:text-indigo-800">
          + Add field
        </button>
      </div>

      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}

      <div className="flex gap-2">
        <button
          onClick={resend}
          disabled={busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Resend through pipeline'}
        </button>
        <button
          onClick={dismiss}
          disabled={busy}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
