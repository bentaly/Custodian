import { useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useRouter } from '@tanstack/react-router'
import { listClientUsers } from '../../server/fns/users'
import { listInvitations, createInvitation } from '../../server/fns/invitations'

export const Route = createFileRoute('/_authenticated/users')({
  loader: async () => {
    const members = await listClientUsers()
    const invites = await listInvitations()
    return { members, invites }
  },
  component: People,
})

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  contributor: 'Contributor',
  observer: 'Observer',
  trustee: 'Trustee',
}

const INVITABLE_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'contributor', label: 'Contributor' },
  { value: 'observer', label: 'Observer' },
  { value: 'trustee', label: 'Trustee' },
] as const

type InviteRole = (typeof INVITABLE_ROLES)[number]['value']

function People() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { members, invites } = Route.useLoaderData()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('observer')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSent, setInviteSent] = useState(false)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError('')
    setInviteSent(false)
    setInviting(true)

    try {
      await createInvitation({ data: { email: inviteEmail, role: inviteRole } })
      setInviteEmail('')
      setInviteRole('observer')
      setInviteSent(true)
      router.invalidate()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invitation')
    } finally {
      setInviting(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">People</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your team</p>
      </div>

      {/* Team members */}
      <section>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Team members</h2>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Email
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Role
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {member.name}
                    {member.id === user.id && (
                      <span className="ml-2 text-xs text-gray-400">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{member.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {ROLE_LABELS[member.role] ?? member.role}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Invite form — admin only */}
      {isAdmin && (
        <section>
          <h2 className="text-sm font-medium text-gray-700 mb-3">Invite someone</h2>
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <form onSubmit={handleInvite} className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-48">
                <label className="block text-xs font-medium text-gray-500 mb-1">Email address</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                  required
                />
              </div>
              <div className="w-40">
                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={inviting}
                className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {inviting ? 'Sending…' : 'Send invite'}
              </button>
            </form>
            {inviteError && <p className="mt-2 text-sm text-red-500">{inviteError}</p>}
            {inviteSent && (
              <p className="mt-2 text-sm text-green-600">Invitation sent successfully.</p>
            )}
          </div>
        </section>
      )}

      {/* Pending invitations — admin only */}
      {isAdmin && invites.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-gray-700 mb-3">Pending invitations</h2>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Expires
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invites.map((invite) => (
                  <tr key={invite.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">{invite.email}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {ROLE_LABELS[invite.role] ?? invite.role}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(invite.expiresAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
