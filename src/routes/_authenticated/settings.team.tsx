import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { listClientUsers } from '../../server/fns/users'
import { listInvitations, createInvitation } from '../../server/fns/invitations'
import {
  Button,
  DataTable,
  ErrorNote,
  Input,
  Label,
  Pagination,
  Panel,
  PanelTitle,
  Select,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { paginate } from '../../lib/pagination'
import { fmtDate } from '../../lib/format'
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

const cellInk = 'font-display text-body font-medium text-grey-900'
const cellSub = 'font-display text-body text-grey-500'

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
      {/* Each section is a Panel with its own title, as on every other screen — the
          bare <h2> over a card was this page's own invention, and it put the heading
          outside the box it described. */}
      <Panel label="Members">
        <PanelTitle
          right={
            <span className="font-display text-label font-medium" style={{ color: C.faint }}>
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </span>
          }
        >
          Members
        </PanelTitle>
        <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
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
                      <span className="ml-2 font-normal text-grey-400">(you)</span>
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
              {
                id: 'joined',
                header: 'Joined',
                hideBelow: 'md',
                cell: (m: Member) => (
                  <span className={`whitespace-nowrap ${cellSub}`}>{fmtDate(m.createdAt)}</span>
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
      </Panel>

      {isAdmin && (
        <Panel label="Invite someone">
          <PanelTitle>Invite someone</PanelTitle>
          <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
              />
            </div>
            <div className="w-44">
              {/* The app's Select, not a native <select>: this was the last dropdown in
                  the product wearing the browser's own control, hairline and all. */}
              <Label htmlFor="invite-role">Role</Label>
              <Select
                id="invite-role"
                value={inviteRole}
                onChange={(next) => setInviteRole(next as InviteRole)}
                options={INVITABLE_ROLES.map((r) => ({ value: r.value, label: r.label }))}
              />
            </div>
            <Button type="submit" disabled={inviting}>
              {inviting ? 'Sending…' : 'Send invite'}
            </Button>
          </form>
          <ErrorNote error={inviteError} className="mt-3" />
          {inviteSent && (
            <p
              className="mt-3 rounded-chip border px-3 py-2 font-display text-body"
              style={{
                borderColor: C.brandBorder,
                backgroundColor: C.brandBg,
                color: C.brand,
              }}
            >
              Invitation sent.
            </p>
          )}
        </Panel>
      )}

      {isAdmin && invites.length > 0 && (
        <Panel label="Pending invitations">
          <PanelTitle>Pending invitations</PanelTitle>
          <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
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
                    <span className={`whitespace-nowrap ${cellSub}`}>{fmtDate(inv.expiresAt)}</span>
                  ),
                },
              ]}
            />
          </div>
        </Panel>
      )}

      {/* What the roles mean. Lives here because this is where a role is chosen — it is
          reference material, not a screen anyone would navigate to. Last, because you
          read it once and then never again. */}
      <Panel label="Roles">
        <PanelTitle>What each role can do</PanelTitle>
        <ul className="flex flex-col">
          {INVITABLE_ROLES.map((r) => (
            <li
              key={r.value}
              className="flex gap-4 border-t py-3 first:border-t-0 first:pt-0"
              style={{ borderColor: C.wash }}
            >
              <span
                className="w-20 shrink-0 font-display text-body font-medium"
                style={{ color: C.ink }}
              >
                {r.label}
              </span>
              <span className="font-display text-body leading-relaxed" style={{ color: C.sub }}>
                {r.hint}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </SettingsPage>
  )
}
