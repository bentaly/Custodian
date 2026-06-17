import { useEffect, useState } from 'react'
import {
  adminDelete,
  adminGet,
  adminPost,
  API_BASE,
  CANONICAL_FIELDS,
  type MappingRow,
} from './api'

interface ClientOption {
  id: string
  name: string
}

export function Mappings() {
  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientId, setClientId] = useState<string | null>(null)
  const [rows, setRows] = useState<MappingRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sourceKey, setSourceKey] = useState('')
  const [canonicalField, setCanonicalField] = useState(CANONICAL_FIELDS[0]!.key)

  // Client list comes from the public rounds endpoint (no admin token needed).
  useEffect(() => {
    fetch(`${API_BASE}/api/rounds`)
      .then((r) => r.json())
      .then((data: Array<{ client: ClientOption }>) => {
        const uniq = Array.from(new Map(data.map((r) => [r.client.id, r.client])).values())
        setClients(uniq)
        setClientId((c) => c ?? uniq[0]?.id ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  function load() {
    if (!clientId) return
    adminGet<MappingRow[]>(`/api/admin/mappings?clientId=${clientId}`)
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }

  useEffect(load, [clientId])

  async function add() {
    if (!clientId || !sourceKey.trim()) return
    setError(null)
    try {
      await adminPost('/api/admin/mappings', {
        clientId,
        sourceKey: sourceKey.trim(),
        canonicalField,
      })
      setSourceKey('')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function remove(id: string) {
    setError(null)
    try {
      await adminDelete(`/api/admin/mappings/${id}`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
          Foundation
        </label>
        <select
          value={clientId ?? ''}
          onChange={(e) => setClientId(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="rounded-lg bg-white ring-1 ring-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 font-medium">Incoming field</th>
              <th className="px-4 py-2 font-medium">Canonical field</th>
              <th className="px-4 py-2 font-medium">Added by</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No mappings for this foundation yet.
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-gray-700">{m.sourceKey}</td>
                <td className="px-4 py-2 text-gray-700">{m.canonicalField}</td>
                <td className="px-4 py-2 text-xs text-gray-400">{m.addedBy ?? '—'}</td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => remove(m.id)}
                    className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:border-red-300 hover:text-red-500"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">Incoming field name</label>
          <input
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
            placeholder="e.g. org_name"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-gray-500">Canonical field</label>
          <select
            value={canonicalField}
            onChange={(e) => setCanonicalField(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {CANONICAL_FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={add}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          Add
        </button>
      </div>
    </div>
  )
}
