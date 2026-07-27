import { useState } from 'react'
import { createFileRoute, redirect, useRouter, Link } from '@tanstack/react-router'
import { listApiKeys, createApiKey, revokeApiKey } from '../../server/fns/apiKeys'
import {
  Button,
  Card,
  DataTable,
  Input,
  Label,
  StatusPill,
  type TableColumn,
} from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings/api-keys')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ apiKeys: await listApiKeys() }),
  component: ApiKeys,
})

type ApiKeyRow = ReturnType<typeof Route.useLoaderData>['apiKeys'][number]

const cellInk = 'font-display text-[14px] font-medium text-[#141C24]'
const cellSub = 'font-display text-[14px] text-[#637083]'

function maskKey(last4: string) {
  return `cust_sk_••••${last4}`
}

function ApiKeys() {
  const router = useRouter()
  const { apiKeys } = Route.useLoaderData()
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
        <span className={cellSub}>
          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-[120px]',
      cell: (k) =>
        k.revokedAt ? (
          <StatusPill label="Revoked" color="#637083" />
        ) : (
          <StatusPill label="Active" color="#31A650" />
        ),
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

  return (
    <SettingsPage
      title="API keys"
      description="Keys authenticate your intake integration when it posts applications or reports to Custodian. Send the key from your server in the Authorization header — never expose one in browser code."
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          See{' '}
          <Link to="/settings/submissions" className="font-medium text-[#1F7A5C] hover:underline">
            Submitting applications
          </Link>{' '}
          for the endpoints and the fields we expect.
        </p>

        {newKey && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
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
          <Card className="overflow-hidden">
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
      </div>
    </SettingsPage>
  )
}
