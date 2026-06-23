import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { listClients } from '../../server/fns/platform'
import { authClient } from '../../lib/auth-client'

export const Route = createFileRoute('/_authenticated/platform')({
  beforeLoad: ({ context }) => {
    // Platform-level screen — superadmins only. Everyone else has a tenant to be in.
    if (context.user.role !== 'superadmin') throw redirect({ to: '/dashboard' })
  },
  loader: async () => ({ clients: await listClients() }),
  component: Platform,
})

function Platform() {
  const { clients } = Route.useLoaderData()
  const [error, setError] = useState('')

  async function handleImpersonate(userId: string) {
    const { error: impError } = await authClient.admin.impersonateUser({ userId })
    if (impError) {
      setError(impError.message ?? 'Could not start impersonation')
      return
    }
    // Full reload so server-side session/context is re-read as the impersonated user.
    window.location.href = '/dashboard'
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Platform</h1>
        <p className="mt-1 text-sm text-gray-500">
          Log in as a foundation's member to see their data. Create new foundations from the admin app.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Foundations</h2>
        {clients.length === 0 && <p className="text-sm text-gray-500">No foundations yet.</p>}
        {clients.map((client) => (
          <div key={client.id} className="rounded-lg border border-gray-200 bg-white p-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{client.name}</p>
              <p className="text-xs text-gray-400">
                {client.type === 'family_office' ? 'Family office' : 'Charitable foundation'}
              </p>
            </div>
            <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
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
      </section>
    </div>
  )
}
