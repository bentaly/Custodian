import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { listClientUsers } from '../../server/fns/users'
import { listInvitations, createInvitation } from '../../server/fns/invitations'
import { Button, Card, DataTable, Input, Label, Pagination } from '../../components/ui'
import { paginate } from '../../lib/pagination'
import { SettingsPage } from '../../components/SettingsPage'
import { ROLE_LABELS, INVITABLE_ROLES, type InviteRole } from '../../lib/roles'

export const Route = createFileRoute('/_authenticated/settings/team')({
  loader: async ({ context }) => {
    const members = await listClientUsers()
    // Only admins can see or send invitations; skip the query for everyone else.
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    return { members, invites: isAdmin ? await listInvitations() : [] }
  },
  component: Team,
})

type Member = ReturnType<typeof Route.useLoaderData>['members'][number]
type Invite = ReturnType<typeof Route.useLoaderData>['invites'][number]

const cellInk = 'font-display text-[14px] font-medium text-[#141C24]'
const cellSub = 'font-display text-[14px] text-[#637083]'

function Team() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { members, invites } = Route.useLoaderData()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  const [page, setPage] = useState(1)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('trustee')
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
      setInviteRole('trustee')
      setInviteSent(true)
      router.invalidate()
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to send invitation')
    } finally {
      setInviting(false)
    }
  }

  // Paged like every other table, but from the already-loaded set and with the page in
  // local state rather than the URL: a team list is bounded by the foundation's own
  // size, and page 2 of it is not somewhere anyone links to.
  const memberPage = paginate(members, page)

  return (
    <SettingsPage
      title="Team members"
      description="Who has access to your foundation, and what each of them can do."
    >
      <div className="space-y-10">
        <section>
          <div className="overflow-hidden rounded-[16px] border border-[#E4E7EC] bg-white">
            <DataTable
              rows={memberPage.items}
              rowKey={(m) => m.id}
              columns={[
                {
                  id: 'name',
                  header: 'Name',
                  cell: (m: Member) => (
                    <span className={cellInk}>
                      {m.name}
                      {m.id === user.id && (
                        <span className="ml-2 font-normal text-[#97A1AF]">(you)</span>
                      )}
                    </span>
                  ),
                },
                {
                  id: 'email',
                  header: 'Email',
                  hideBelow: 'sm',
                  cell: (m: Member) => <span className={cellSub}>{m.email}</span>,
                },
                {
                  id: 'role',
                  header: 'Role',
                  cell: (m: Member) => (
                    <span className={cellSub}>{ROLE_LABELS[m.role] ?? m.role}</span>
                  ),
                },
              ]}
            />
          </div>
          <div className="mt-4">
            <Pagination
              page={memberPage.page}
              pageCount={Math.max(1, Math.ceil(memberPage.total / memberPage.pageSize))}
              shown={memberPage.items.length}
              total={memberPage.total}
              noun="team members"
              onChange={setPage}
            />
          </div>
        </section>

        {/* What the roles mean. Lives here because this is where a role is chosen —
            it is reference material, not a screen anyone would navigate to. */}
        <section>
          <h2 className="mb-3 text-sm font-medium text-gray-700">What each role can do</h2>
          <Card className="divide-y divide-gray-100">
            {INVITABLE_ROLES.map((r) => (
              <div key={r.value} className="flex gap-4 px-5 py-3.5">
                <span className="w-20 shrink-0 text-sm font-medium text-[#141C24]">{r.label}</span>
                <span className="text-sm text-[#637083]">{r.hint}</span>
              </div>
            ))}
          </Card>
        </section>

        {isAdmin && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-gray-700">Invite someone</h2>
            <Card className="p-5">
              <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <Label>Email address</Label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    required
                  />
                </div>
                <div className="w-40">
                  <Label>Role</Label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                    className="w-full rounded-sm border border-gray-300 px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-400"
                  >
                    {INVITABLE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={inviting}>
                  {inviting ? 'Sending…' : 'Send invite'}
                </Button>
              </form>
              {inviteError && <p className="mt-2 text-sm text-red-500">{inviteError}</p>}
              {inviteSent && (
                <p className="mt-2 text-sm text-green-600">Invitation sent successfully.</p>
              )}
            </Card>
          </section>
        )}

        {isAdmin && invites.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-gray-700">Pending invitations</h2>
            <div className="overflow-hidden rounded-[16px] border border-[#E4E7EC] bg-white">
              <DataTable
                rows={invites}
                rowKey={(inv) => inv.id}
                columns={[
                  {
                    id: 'email',
                    header: 'Email',
                    cell: (inv: Invite) => <span className={cellInk}>{inv.email}</span>,
                  },
                  {
                    id: 'role',
                    header: 'Role',
                    cell: (inv: Invite) => (
                      <span className={cellSub}>{ROLE_LABELS[inv.role] ?? inv.role}</span>
                    ),
                  },
                  {
                    id: 'expires',
                    header: 'Expires',
                    hideBelow: 'sm',
                    cell: (inv: Invite) => (
                      <span className={cellSub}>
                        {new Date(inv.expiresAt).toLocaleDateString()}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </section>
        )}
      </div>
    </SettingsPage>
  )
}
