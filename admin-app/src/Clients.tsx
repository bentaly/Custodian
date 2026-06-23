import { useEffect, useState } from 'react'
import { adminGet, adminPost } from './api'

interface ClientRow {
  id: string
  name: string
  type: 'charitable_foundation' | 'family_office'
  users: Array<{ id: string; name: string; email: string; role: string }>
}

export function Clients() {
  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [name, setName] = useState('')
  const [type, setType] = useState<'charitable_foundation' | 'family_office'>('charitable_foundation')
  const [adminEmail, setAdminEmail] = useState('')
  const [creating, setCreating] = useState(false)
  const [lastInvite, setLastInvite] = useState<{ name: string; url: string } | null>(null)

  async function load() {
    setLoading(true)
    setError('')
    try {
      setClients(await adminGet<ClientRow[]>('/api/admin/clients'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load foundations')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      const { client, inviteUrl } = await adminPost<{ client: ClientRow; inviteUrl: string }>(
        '/api/admin/clients',
        { name, type, adminEmail },
      )
      setLastInvite({ name: client.name, url: inviteUrl })
      setName('')
      setAdminEmail('')
      setType('charitable_foundation')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create foundation')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-gray-900">New foundation</h2>
        <p className="mt-1 text-xs text-gray-500">
          Creates the tenant and emails its first admin an invitation to set up their account.
        </p>
        <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Foundation name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            required
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="charitable_foundation">Charitable foundation</option>
            <option value="family_office">Family office</option>
          </select>
          <input
            type="email"
            placeholder="First admin's email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 sm:col-span-2"
            required
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 sm:col-span-2"
          >
            {creating ? 'Creating…' : 'Create foundation & invite admin'}
          </button>
        </form>

        {lastInvite && (
          <div className="mt-4 rounded border border-green-200 bg-green-50 p-3">
            <p className="text-xs font-medium text-green-800">
              {lastInvite.name} created. Invite link (also emailed):
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                readOnly
                value={lastInvite.url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 rounded border border-green-300 bg-white px-2 py-1 text-xs text-gray-700"
              />
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(lastInvite.url)}
                className="rounded border border-green-300 px-2 py-1 text-xs text-green-800 hover:bg-green-100"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Foundations</h2>
        {loading && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && clients.length === 0 && <p className="text-sm text-gray-500">No foundations yet.</p>}
        {clients.map((client) => (
          <div key={client.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm font-medium text-gray-900">{client.name}</p>
            <p className="text-xs text-gray-400">
              {client.type === 'family_office' ? 'Family office' : 'Charitable foundation'}
            </p>
            <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
              {client.users.length === 0 ? (
                <p className="text-xs text-gray-400">No members yet — admin invite pending.</p>
              ) : (
                client.users.map((u) => (
                  <p key={u.id} className="text-sm text-gray-600">
                    {u.name} · <span className="text-gray-400">{u.email}</span> ·{' '}
                    <span className="text-gray-400">{u.role}</span>
                  </p>
                ))
              )}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
