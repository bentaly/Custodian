import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { listClientUsers } from '../../server/fns/users'
import {
  listInvitations,
  createInvitation,
  resendInvitation,
  revokeInvitation,
} from '../../server/fns/invitations'
import { removeMember, setMemberRole } from '../../server/fns/team'
import {
  ActionMenu,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  ErrorNote,
  Input,
  Label,
  Pagination,
  Panel,
  PanelTitle,
  Select,
  type TableColumn,
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

const messageOf = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mt-3 rounded-chip border px-3 py-2 font-display text-body"
      style={{ borderColor: C.brandBorder, backgroundColor: C.brandBg, color: C.brand }}
    >
      {children}
    </p>
  )
}

function Team() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { members, invites } = Route.useLoaderData()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'
  const org = user.clientName ?? 'your foundation'

  const [page, setPage] = useState(1)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('trustee')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSent, setInviteSent] = useState(false)

  // ── Member actions ─────────────────────────────────────────────────────────
  const [memberNotice, setMemberNotice] = useState('')
  const [roleTarget, setRoleTarget] = useState<Member | null>(null)
  const [nextRole, setNextRole] = useState<InviteRole>('trustee')
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null)
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState('')

  // ── Invitation actions ─────────────────────────────────────────────────────
  const [inviteNotice, setInviteNotice] = useState('')
  const [inviteActionError, setInviteActionError] = useState('')
  const [revokeTarget, setRevokeTarget] = useState<Invite | null>(null)
  const [inviteBusy, setInviteBusy] = useState(false)

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

  function openRole(m: Member) {
    setMemberError('')
    setMemberNotice('')
    setNextRole(
      (INVITABLE_ROLES.some((r) => r.value === m.role) ? m.role : 'trustee') as InviteRole,
    )
    setRoleTarget(m)
  }

  function openRemove(m: Member) {
    setMemberError('')
    setMemberNotice('')
    setRemoveTarget(m)
  }

  function closeMemberDialogs() {
    if (memberBusy) return
    setRoleTarget(null)
    setRemoveTarget(null)
    setMemberError('')
  }

  async function handleRoleSave() {
    if (!roleTarget) return
    setMemberBusy(true)
    setMemberError('')
    try {
      await setMemberRole({ data: { userId: roleTarget.id, role: nextRole } })
      setMemberNotice(`${roleTarget.name} is now ${ROLE_LABELS[nextRole]?.toLowerCase()}.`)
      setRoleTarget(null)
      router.invalidate()
    } catch (err) {
      setMemberError(messageOf(err, 'Could not change their role.'))
    } finally {
      setMemberBusy(false)
    }
  }

  async function handleRemove() {
    if (!removeTarget) return
    setMemberBusy(true)
    setMemberError('')
    try {
      await removeMember({ data: { userId: removeTarget.id } })
      setMemberNotice(`${removeTarget.name} has been removed from the team.`)
      setRemoveTarget(null)
      router.invalidate()
    } catch (err) {
      setMemberError(messageOf(err, 'Could not remove them.'))
    } finally {
      setMemberBusy(false)
    }
  }

  async function handleResend(inv: Invite) {
    setInviteBusy(true)
    setInviteNotice('')
    setInviteActionError('')
    try {
      await resendInvitation({ data: { invitationId: inv.id } })
      setInviteNotice(`Invitation sent again to ${inv.email}. The earlier link no longer works.`)
      router.invalidate()
    } catch (err) {
      setInviteActionError(messageOf(err, 'Could not resend that invitation.'))
    } finally {
      setInviteBusy(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    setInviteBusy(true)
    setInviteActionError('')
    try {
      await revokeInvitation({ data: { invitationId: revokeTarget.id } })
      setInviteNotice(`Invitation for ${revokeTarget.email} cancelled.`)
      setRevokeTarget(null)
      router.invalidate()
    } catch (err) {
      setInviteActionError(messageOf(err, 'Could not cancel that invitation.'))
    } finally {
      setInviteBusy(false)
    }
  }

  // Paged like every other table, but from the already-loaded set and with the page in
  // local state rather than the URL: a team list is bounded by the foundation's own
  // size, and page 2 of it is not somewhere anyone links to.
  const memberPage = paginate(members, page)

  // Your own row carries no actions: removing yourself goes through Profile and its
  // emailed code, and a platform account is not the foundation's to change.
  const manageable = (m: Member) => m.id !== user.id && m.role !== 'superadmin'

  const memberColumns: TableColumn<Member>[] = [
    {
      id: 'name',
      header: 'Name',
      cell: (m) => (
        <span className={cellInk}>
          {m.name}
          {m.id === user.id && <span className="ml-2 font-normal text-grey-400">(you)</span>}
        </span>
      ),
    },
    {
      id: 'email',
      header: 'Email',
      hideBelow: 'sm',
      cell: (m) => <span className={cellSub}>{m.email}</span>,
    },
    {
      id: 'role',
      header: 'Role',
      width: 'sm:w-[15%]',
      cell: (m) => <span className={cellSub}>{ROLE_LABELS[m.role] ?? m.role}</span>,
    },
    {
      id: 'joined',
      header: 'Joined',
      hideBelow: 'md',
      width: 'sm:w-[15%]',
      cell: (m) => <span className={`whitespace-nowrap ${cellSub}`}>{fmtDate(m.createdAt)}</span>,
    },
  ]
  if (isAdmin) {
    memberColumns.push({
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-14',
      cell: (m) =>
        manageable(m) ? (
          <ActionMenu
            label={`Actions for ${m.name}`}
            actions={[
              { label: 'Change role', onSelect: () => openRole(m) },
              { label: 'Remove from team', destructive: true, onSelect: () => openRemove(m) },
            ]}
          />
        ) : null,
    })
  }

  const inviteExpired = (inv: Invite) => new Date(inv.expiresAt).getTime() < Date.now()
  const inviteColumns: TableColumn<Invite>[] = [
    {
      id: 'email',
      header: 'Email',
      cell: (inv) => <span className={cellInk}>{inv.email}</span>,
    },
    {
      id: 'role',
      header: 'Role',
      width: 'sm:w-[15%]',
      cell: (inv) => <span className={cellSub}>{ROLE_LABELS[inv.role] ?? inv.role}</span>,
    },
    {
      id: 'expires',
      header: 'Expires',
      hideBelow: 'sm',
      width: 'sm:w-[15%]',
      cell: (inv) =>
        inviteExpired(inv) ? (
          <span className="font-display text-body text-danger">Expired</span>
        ) : (
          <span className={`whitespace-nowrap ${cellSub}`}>{fmtDate(inv.expiresAt)}</span>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-14',
      cell: (inv) => (
        <ActionMenu
          label={`Actions for the invitation to ${inv.email}`}
          actions={[
            { label: 'Resend invitation', onSelect: () => handleResend(inv), disabled: inviteBusy },
            {
              label: 'Cancel invitation',
              destructive: true,
              disabled: inviteBusy,
              onSelect: () => {
                setInviteActionError('')
                setRevokeTarget(inv)
              },
            },
          ]}
        />
      ),
    },
  ]

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
          <DataTable rows={memberPage.items} rowKey={(m) => m.id} columns={memberColumns} />
        </div>
        {memberNotice && <Notice>{memberNotice}</Notice>}
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
          {inviteSent && <Notice>Invitation sent.</Notice>}
        </Panel>
      )}

      {isAdmin && (invites.length > 0 || inviteNotice) && (
        <Panel label="Pending invitations">
          <PanelTitle>Pending invitations</PanelTitle>
          {invites.length > 0 && (
            <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
              <DataTable rows={invites} rowKey={(inv) => inv.id} columns={inviteColumns} />
            </div>
          )}
          {inviteNotice && <Notice>{inviteNotice}</Notice>}
          {!revokeTarget && <ErrorNote error={inviteActionError} className="mt-3" />}
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

      <Dialog
        open={!!roleTarget}
        title={roleTarget ? `Change ${roleTarget.name}'s role` : 'Change role'}
        onClose={closeMemberDialogs}
        busy={memberBusy}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={closeMemberDialogs}
              disabled={memberBusy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleRoleSave}
              disabled={memberBusy || nextRole === roleTarget?.role}
            >
              {memberBusy ? 'Saving…' : 'Save role'}
            </Button>
          </div>
        }
      >
        <Label htmlFor="member-role">Role</Label>
        <Select
          id="member-role"
          value={nextRole}
          onChange={(next) => setNextRole(next as InviteRole)}
          options={INVITABLE_ROLES.map((r) => ({ value: r.value, label: r.label }))}
        />
        <p className="mt-2 font-display text-body leading-relaxed text-grey-500">
          {INVITABLE_ROLES.find((r) => r.value === nextRole)?.hint}
        </p>
        {roleTarget?.role === 'trustee' && nextRole !== 'trustee' && (
          <p className="mt-2 font-display text-body leading-relaxed text-grey-500">
            Their votes on applications still being decided will stop counting towards the majority.
            Votes on decisions already made are unaffected.
          </p>
        )}
        <p className="mt-2 font-display text-body leading-relaxed text-grey-500">
          The change takes effect the next time they do anything in Custodian.
        </p>
        <ErrorNote error={memberError} className="mt-3" />
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        title={removeTarget ? `Remove ${removeTarget.name} from the team?` : 'Remove from team?'}
        onCancel={closeMemberDialogs}
        onConfirm={handleRemove}
        confirmLabel="Remove from team"
        busyLabel="Removing…"
        busy={memberBusy}
        error={memberError}
      >
        {removeTarget && (
          <>
            <p>
              {removeTarget.name} will be signed out straight away and will no longer be able to
              sign in to {org}. We'll email them to let them know.
            </p>
            <p className="mt-2">
              Their votes, comments and past activity stay on record under their name.
              {removeTarget.role === 'trustee' &&
                ' Their votes on applications still being decided will stop counting towards the majority.'}
            </p>
            <p className="mt-2">You can invite them again later if you need to.</p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!revokeTarget}
        title="Cancel this invitation?"
        onCancel={() => !inviteBusy && setRevokeTarget(null)}
        onConfirm={handleRevoke}
        confirmLabel="Cancel invitation"
        busyLabel="Cancelling…"
        busy={inviteBusy}
        error={inviteActionError}
      >
        {revokeTarget && (
          <p>
            The link sent to {revokeTarget.email} will stop working. You can invite them again at
            any time.
          </p>
        )}
      </ConfirmDialog>
    </SettingsPage>
  )
}
