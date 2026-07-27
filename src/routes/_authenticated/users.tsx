import { useState, useCallback } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useRouter } from '@tanstack/react-router'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { listClientUsers } from '../../server/fns/users'
import { listInvitations, createInvitation } from '../../server/fns/invitations'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { listApiKeys, createApiKey, revokeApiKey } from '../../server/fns/apiKeys'
import { Button, Card, DataTable, Input, Label, StatusPill, type TableColumn } from '../../components/ui'

type Member = ReturnType<typeof Route.useLoaderData>['members'][number]
type Invite = ReturnType<typeof Route.useLoaderData>['invites'][number]

const cellInk = 'font-display text-[14px] font-medium text-[#141C24]'
const cellSub = 'font-display text-[14px] text-[#637083]'

export const Route = createFileRoute('/_authenticated/users')({
  loader: async () => {
    const members = await listClientUsers()
    const invites = await listInvitations()
    const profile = await getClientProfile()
    const apiKeys = await listApiKeys()
    return { members, invites, profile, apiKeys }
  },
  component: Organisation,
})

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  trustee: 'Trustee',
  finance: 'Finance',
}

// Shown on the invite form; the descriptions double as the roles-and-permissions
// explainer, which is why they live next to where a role is actually assigned.
const INVITABLE_ROLES = [
  { value: 'admin', label: 'Admin', hint: 'Full access — rounds, programmes, decisions and payments.' },
  { value: 'trustee', label: 'Trustee', hint: 'Reads applications, comments and votes.' },
  { value: 'finance', label: 'Finance', hint: 'Trustee access plus the payment schedule.' },
] as const

type InviteRole = (typeof INVITABLE_ROLES)[number]['value']

function ToolbarButton({
  onClick,
  active,
  disabled,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      disabled={disabled}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-gray-800 text-white'
          : 'text-gray-600 hover:bg-gray-100 disabled:opacity-40'
      }`}
    >
      {children}
    </button>
  )
}

function MissionStatementEditor({ initialContent }: { initialContent: string }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const editor = useEditor({
    // StarterKit bundles Underline as of tiptap 3.x.
    extensions: [StarterKit, Markdown],
    content: initialContent || '',
    editorProps: {
      attributes: {
        class:
          'min-h-[160px] px-3 py-2 text-sm text-gray-900 focus:outline-hidden prose prose-sm max-w-none',
      },
    },
  })

  const handleSave = useCallback(async () => {
    if (!editor) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markdown = (editor.storage as any).markdown.getMarkdown() as string
      await upsertClientProfile({ data: { missionStatement: markdown } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }, [editor])

  if (!editor) return null

  return (
    <div>
      <div className="rounded-sm border border-gray-300 focus-within:ring-2 focus-within:ring-gray-400">
        <div className="flex flex-wrap gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
          >
            B
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive('underline')}
          >
            <span className="underline">U</span>
          </ToolbarButton>
          <span className="mx-1 border-l border-gray-200" />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive('heading', { level: 1 })}
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
          >
            H3
          </ToolbarButton>
          <span className="mx-1 border-l border-gray-200" />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
          >
            • List
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
          >
            1. List
          </ToolbarButton>
        </div>
        <EditorContent editor={editor} />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      <Button onClick={handleSave} disabled={saving} className="mt-3">
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </Button>
    </div>
  )
}

function AdminVotingToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleToggle() {
    const next = !enabled
    setEnabled(next)
    setSaving(true)
    setError('')
    try {
      await upsertClientProfile({ data: { allowAdminVoting: next } })
    } catch {
      setEnabled(!next) // revert on failure
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="flex items-center justify-between p-4">
      <div className="pr-4">
        <p className="text-sm font-medium text-gray-700">Allow admins to vote on behalf of trustees</p>
        <p className="mt-0.5 text-sm text-gray-500">
          When enabled, admins can record yes/no votes for any trustee on an application — useful
          when a trustee sends their decision outside the platform.
        </p>
        {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={handleToggle}
        disabled={saving}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? 'bg-gray-900' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </Card>
  )
}

function Organisation() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { members, invites, profile, apiKeys } = Route.useLoaderData()
  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

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

  return (
    <div className="max-w-3xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Organisation</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your team and organisation settings</p>
      </div>

      {/* Giving strategy — admin only */}
      {isAdmin && user.clientId && (
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium text-gray-700">Giving strategy</h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Describe your organisation's goals and funding priorities. This will be used to score
              incoming applications.
            </p>
          </div>
          <MissionStatementEditor initialContent={profile?.missionStatement ?? ''} />
        </section>
      )}

      {/* Voting — admin only */}
      {isAdmin && user.clientId && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-gray-700">Voting</h2>
          <AdminVotingToggle initialEnabled={profile?.allowAdminVoting ?? false} />
        </section>
      )}

      {/* Team members */}
      <section>
        <h2 className="text-sm font-medium text-gray-700 mb-3">Team members</h2>
        <div className="overflow-hidden rounded-[16px] border border-[#E4E7EC] bg-white">
          <DataTable
            rows={members}
            rowKey={(m) => m.id}
            columns={[
              {
                id: 'name',
                header: 'Name',
                cell: (m: Member) => (
                  <span className={cellInk}>
                    {m.name}
                    {m.id === user.id && <span className="ml-2 font-normal text-[#97A1AF]">(you)</span>}
                  </span>
                ),
              },
              { id: 'email', header: 'Email', cell: (m: Member) => <span className={cellSub}>{m.email}</span> },
              { id: 'role', header: 'Role', cell: (m: Member) => <span className={cellSub}>{ROLE_LABELS[m.role] ?? m.role}</span> },
            ]}
          />
        </div>
      </section>

      {/* Invite form — admin only */}
      {isAdmin && (
        <section>
          <h2 className="text-sm font-medium text-gray-700 mb-3">Invite someone</h2>
          <Card className="p-5">
            <form onSubmit={handleInvite} className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-48">
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
              {/* Full-width so it wraps onto its own line under the controls. */}
              <p className="w-full text-xs text-gray-500">
                {INVITABLE_ROLES.find((r) => r.value === inviteRole)?.hint}
              </p>
            </form>
            {inviteError && <p className="mt-2 text-sm text-red-500">{inviteError}</p>}
            {inviteSent && (
              <p className="mt-2 text-sm text-green-600">Invitation sent successfully.</p>
            )}
          </Card>
        </section>
      )}

      {/* Pending invitations — admin only */}
      {isAdmin && invites.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-gray-700 mb-3">Pending invitations</h2>
          <div className="overflow-hidden rounded-[16px] border border-[#E4E7EC] bg-white">
            <DataTable
              rows={invites}
              rowKey={(inv) => inv.id}
              columns={[
                { id: 'email', header: 'Email', cell: (inv: Invite) => <span className={cellInk}>{inv.email}</span> },
                { id: 'role', header: 'Role', cell: (inv: Invite) => <span className={cellSub}>{ROLE_LABELS[inv.role] ?? inv.role}</span> },
                { id: 'expires', header: 'Expires', cell: (inv: Invite) => <span className={cellSub}>{new Date(inv.expiresAt).toLocaleDateString()}</span> },
              ]}
            />
          </div>
        </section>
      )}

      {/* API keys — admin only */}
      {isAdmin && <ApiKeysSection apiKeys={apiKeys} />}
    </div>
  )
}

function maskKey(last4: string) {
  return `cust_sk_••••${last4}`
}

type ApiKeyRow = ReturnType<typeof Route.useLoaderData>['apiKeys'][number]

function ApiKeysSection({ apiKeys }: { apiKeys: ApiKeyRow[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNewKey(null)
    setCreating(true)
    try {
      const created = await createApiKey({ data: { name } })
      setNewKey(created.key)
      setName('')
      router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  const keyColumns: TableColumn<ApiKeyRow>[] = [
    { id: 'name', header: 'Name', cell: (k) => <span className={cellInk}>{k.name}</span> },
    {
      id: 'key',
      header: 'Key',
      cell: (k) => <span className="font-mono text-[13px] text-[#637083]">{maskKey(k.last4)}</span>,
    },
    {
      id: 'created',
      header: 'Created',
      width: 'w-[140px]',
      cell: (k) => <span className={cellSub}>{new Date(k.createdAt).toLocaleDateString()}</span>,
    },
    {
      id: 'lastUsed',
      header: 'Last used',
      width: 'w-[140px]',
      cell: (k) => (
        <span className={cellSub}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-[120px]',
      cell: (k) =>
        k.revokedAt ? <StatusPill label="Revoked" color="#637083" /> : <StatusPill label="Active" color="#31A650" />,
    },
    {
      id: 'actions',
      header: '',
      width: 'w-[100px]',
      align: 'right',
      cell: (k) =>
        k.revokedAt ? null : (
          <button
            onClick={() => handleRevoke(k.id)}
            disabled={revokingId === k.id}
            className="font-display text-[13px] text-red-600 hover:text-red-800 disabled:opacity-50"
          >
            {revokingId === k.id ? 'Revoking…' : 'Revoke'}
          </button>
        ),
    },
  ]

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this key? Any integration using it will stop working immediately.')) return
    setRevokingId(id)
    try {
      await revokeApiKey({ data: { id } })
      router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke key')
    } finally {
      setRevokingId(null)
    }
  }

  async function copyKey() {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-gray-700 mb-1">API keys</h2>
      <p className="mb-3 text-sm text-gray-500">
        Keys authenticate your intake integration when it posts applications to{' '}
        <code className="rounded-sm bg-gray-100 px-1 py-0.5 text-xs">/api/apply</code>. Send the key in
        the <code className="rounded-sm bg-gray-100 px-1 py-0.5 text-xs">Authorization: Bearer …</code>{' '}
        header from your server — never expose it in browser code.
      </p>

      {newKey && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            Key created — copy it now. You won't be able to see it again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-sm border border-green-300 bg-white px-3 py-2 text-xs text-gray-900">
              {newKey}
            </code>
            <button
              type="button"
              onClick={copyKey}
              className="shrink-0 rounded-sm bg-green-700 px-3 py-2 text-xs font-medium text-white hover:bg-green-800"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {apiKeys.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <DataTable
            columns={keyColumns}
            rows={apiKeys}
            rowKey={(k) => k.id}
            rowClassName={(k) => (k.revokedAt ? 'opacity-50' : '')}
          />
        </Card>
      )}

      <Card className="p-5">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Label>Key name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Website intake form"
              required
            />
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? 'Generating…' : 'Generate key'}
          </Button>
        </form>
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      </Card>
    </section>
  )
}
