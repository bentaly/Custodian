import { useState } from 'react'
import { createFileRoute, redirect, useRouter, Link } from '@tanstack/react-router'
import { listApiKeys, createApiKey, revokeApiKey } from '../../server/fns/apiKeys'
import {
  Button,
  Card,
  DataTable,
  Input,
  Label,
  Pagination,
  StatusPill,
  TextLink,
  type TableColumn,
} from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'
import { paginate } from '../../lib/pagination'

export const Route = createFileRoute('/_authenticated/settings/api-keys')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ apiKeys: await listApiKeys() }),
  component: ApiKeys,
})

type ApiKeyRow = ReturnType<typeof Route.useLoaderData>['apiKeys'][number]

const cellInk = 'font-display text-body font-medium text-grey-900'
const cellSub = 'font-display text-body text-grey-500'

function maskKey(last4: string) {
  return `cust_sk_••••${last4}`
}

function ApiKeys() {
  const router = useRouter()
  const { apiKeys } = Route.useLoaderData()
  // Same paged contract as every other table, from the loaded set — see
  // `settings/team` for why the page number stays out of the URL here.
  const [page, setPage] = useState(1)
  const keyPage = paginate(apiKeys, page)
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

  const keyColumns: TableColumn<ApiKeyRow>[] = [
    { id: 'name', header: 'Name', cell: (k) => <span className={cellInk}>{k.name}</span> },
    {
      id: 'key',
      hideBelow: 'sm',
      header: 'Key',
      cell: (k) => <span className="font-mono text-body text-grey-500">{maskKey(k.last4)}</span>,
    },
    {
      id: 'created',
      hideBelow: 'lg',
      header: 'Created',
      width: 'sm:w-[140px]',
      cell: (k) => <span className={cellSub}>{new Date(k.createdAt).toLocaleDateString()}</span>,
    },
    {
      id: 'lastUsed',
      hideBelow: 'md',
      header: 'Last used',
      width: 'sm:w-[140px]',
      cell: (k) => (
        <span className={cellSub}>
          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'sm:w-[120px]',
      cell: (k) =>
        k.revokedAt ? (
          <StatusPill label="Revoked" colour="var(--color-grey-500)" />
        ) : (
          <StatusPill label="Active" colour="var(--color-success)" />
        ),
    },
    {
      id: 'actions',
      header: '',
      width: 'sm:w-[100px]',
      align: 'right',
      cell: (k) =>
        k.revokedAt ? null : (
          <Button
            variant="dangerGhost"
            size="xs"
            onClick={() => handleRevoke(k.id)}
            disabled={revokingId === k.id}
          >
            {revokingId === k.id ? 'Revoking…' : 'Revoke'}
          </Button>
        ),
    },
  ]

  return (
    <SettingsPage
      title="API keys"
      description="Keys authenticate your intake integration when it posts applications or reports to Custodian. Send the key from your server in the Authorization header — never expose one in browser code."
    >
      <div className="space-y-4">
        <p className="text-body text-grey-500">
          See <TextLink to="/settings/submissions">Submitting applications</TextLink> for the
          endpoints and the fields we expect.
        </p>

        {newKey && (
          <div className="rounded-card border border-success/20 bg-success/10 p-4">
            <p className="text-body font-medium text-success">
              Key created — copy it now. You won't be able to see it again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-chip border border-success/20 bg-white px-3 py-2 text-label text-grey-900">
                {newKey}
              </code>
              <Button size="sm" onClick={copyKey}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}

        {apiKeys.length > 0 && (
          <>
            <Card className="overflow-hidden">
              <DataTable
                columns={keyColumns}
                rows={keyPage.items}
                rowKey={(k) => k.id}
                rowClassName={(k) => (k.revokedAt ? 'opacity-50' : '')}
              />
            </Card>
            <Pagination
              page={keyPage.page}
              pageCount={Math.max(1, Math.ceil(keyPage.total / keyPage.pageSize))}
              shown={keyPage.items.length}
              total={keyPage.total}
              noun="keys"
              onChange={setPage}
            />
          </>
        )}

        <Card className="p-4">
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
          {error && <p className="mt-2 text-body text-danger">{error}</p>}
        </Card>
      </div>
    </SettingsPage>
  )
}
