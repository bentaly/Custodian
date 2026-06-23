import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '../../lib/auth-client'
import { listClients } from '../../server/fns/platform'

export const Route = createFileRoute('/_authenticated/profile')({
  // Impersonation targets are only needed for platform superadmins; everyone
  // else skips the (superadmin-gated) query entirely.
  loader: async ({ context }) =>
    context.user.role === 'superadmin' ? { clients: await listClients() } : { clients: [] },
  component: Profile,
})

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  contributor: 'Contributor',
  observer: 'Observer',
  trustee: 'Trustee',
}

function Profile() {
  const { user } = Route.useRouteContext()
  const { clients } = Route.useLoaderData()
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [impersonateError, setImpersonateError] = useState('')

  async function handleImpersonate(userId: string) {
    const { error: impError } = await authClient.admin.impersonateUser({ userId })
    if (impError) {
      setImpersonateError(impError.message ?? 'Could not start impersonation')
      return
    }
    // Full reload so server-side session/context is re-read as the impersonated user.
    window.location.href = '/dashboard'
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (name === user.name) return
    setSaving(true)
    setError('')
    setSaved(false)

    const { error: updateError } = await authClient.updateUser({ name })
    setSaving(false)
    if (updateError) {
      setError(updateError.message ?? 'Failed to update name')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-gray-900">Profile</h1>
      <p className="mt-1 text-sm text-gray-500">Your account details</p>

      <div className="mt-8 space-y-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={user.email}
              readOnly
              className="mt-1 w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={saving || name === user.name}
            className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </button>
        </form>

        <div className="border-t border-gray-100 pt-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Role</span>
            <span className="font-medium text-gray-800">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
        </div>

        {user.role === 'superadmin' && (
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-sm font-semibold text-gray-900">Log in as a foundation</h2>
            <p className="mt-1 text-xs text-gray-500">
              See a foundation's data as one of its members. Create foundations from the admin app.
            </p>
            {impersonateError && <p className="mt-2 text-sm text-red-500">{impersonateError}</p>}
            <div className="mt-3 space-y-3">
              {clients.length === 0 && <p className="text-sm text-gray-500">No foundations yet.</p>}
              {clients.map((client) => (
                <div key={client.id} className="rounded-lg border border-gray-200 p-3">
                  <p className="text-sm font-medium text-gray-900">{client.name}</p>
                  <div className="mt-2 space-y-1">
                    {client.users.length === 0 && (
                      <p className="text-xs text-gray-400">No members yet — admin invite pending.</p>
                    )}
                    {client.users.map((u) => (
                      <div key={u.id} className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">
                          {u.name} · <span className="text-gray-400">{u.email}</span>
                        </span>
                        <button
                          onClick={() => handleImpersonate(u.id)}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          Log in as
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
