import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { authClient } from '../../lib/auth-client'

export const Route = createFileRoute('/_authenticated/profile')({
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
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

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
      </div>
    </div>
  )
}
