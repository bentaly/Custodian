import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { listApiKeys, createApiKey, revokeApiKey } from '../../server/fns/apiKeys'
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
  StatusPill,
  TextLink,
  type TableColumn,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { SettingsPage } from '../../components/SettingsPage'
import { paginate } from '../../lib/pagination'
import { fmtDate } from '../../lib/format'

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

type KeyKind = 'secret' | 'webhook'

function maskKey(kind: KeyKind, last4: string) {
  return `${kind === 'webhook' ? 'cust_wh_' : 'cust_sk_'}••••${last4}`
}

// A webhook token is only useful as the URL it belongs in — the form platform has one
// box, and it takes an address. So the reveal shows the whole address, not the token:
// the alternative is telling somebody to assemble a URL by hand from a secret they can
// only see once. Built from the live origin so staging and local dev are right too.
function webhookUrl(token: string) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `${origin}/api/webhooks/typeform/${token}`
}

function ApiKeys() {
  const router = useRouter()
  const { apiKeys } = Route.useLoaderData()
  // Same paged contract as every other table, from the loaded set — see
  // `settings/team` for why the page number stays out of the URL here.
  const [page, setPage] = useState(1)
  const keyPage = paginate(apiKeys, page)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<KeyKind>('secret')
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [newSecret, setNewSecret] = useState<{ value: string; kind: KeyKind } | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNewSecret(null)
    setCreating(true)
    try {
      const created = await createApiKey({ data: { name, kind } })
      setNewSecret({
        value: kind === 'webhook' ? webhookUrl(created.key) : created.key,
        kind,
      })
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
    if (!newSecret) return
    await navigator.clipboard.writeText(newSecret.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const keyColumns: TableColumn<ApiKeyRow>[] = [
    { id: 'name', header: 'Name', cell: (k) => <span className={cellInk}>{k.name}</span> },
    {
      id: 'key',
      hideBelow: 'sm',
      header: 'Key',
      width: 'sm:w-[18%]',
      cell: (k) => (
        <span className="font-mono text-body text-grey-500">{maskKey(k.kind, k.last4)}</span>
      ),
    },
    {
      id: 'kind',
      hideBelow: 'md',
      header: 'Used by',
      width: 'sm:w-[14%]',
      cell: (k) => (
        <span className={cellSub}>{k.kind === 'webhook' ? 'Form platform' : 'Your server'}</span>
      ),
    },
    {
      id: 'created',
      hideBelow: 'lg',
      header: 'Created',
      width: 'sm:w-[13%]',
      cell: (k) => <span className={cellSub}>{fmtDate(k.createdAt)}</span>,
    },
    {
      id: 'lastUsed',
      hideBelow: 'md',
      header: 'Last used',
      width: 'sm:w-[13%]',
      cell: (k) => (
        <span className={cellSub}>{k.lastUsedAt ? fmtDate(k.lastUsedAt) : 'Never'}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      width: 'sm:w-[12%]',
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
      width: 'sm:w-[10%]',
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
      description="Keys authenticate your intake integration when it posts applications or reports to Custodian. A server sends its key in the Authorization header; a form platform gets a webhook address with the key already in it, because most of them cannot send headers. Never expose either in browser code."
    >
      <p className="font-display text-body" style={{ color: C.sub }}>
        See <TextLink to="/settings/submissions">Submitting applications</TextLink> for the
        endpoints and the fields we expect.
      </p>

      {/* Shown once, and never again — so it is the loudest thing on the screen while it
          is here. */}
      {newSecret && (
        <div
          className="rounded-card border p-4"
          style={{ borderColor: C.brandBorder, backgroundColor: C.brandBg }}
        >
          <p className="font-display text-body font-medium" style={{ color: C.brand }}>
            {newSecret.kind === 'webhook'
              ? "Webhook address created — copy it now. You won't be able to see it again."
              : "Key created — copy it now. You won't be able to see it again."}
          </p>
          {newSecret.kind === 'webhook' && (
            <p className="mt-1 font-display text-label" style={{ color: C.sub }}>
              Paste it into your form's webhook settings — in Typeform, Connect → Webhooks → Add a
              webhook. The address contains the key, so treat it like one.
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <code
              className="flex-1 overflow-x-auto rounded-chip border bg-white px-3 py-2 font-mono text-label"
              style={{ borderColor: C.brandBorder, color: C.ink }}
            >
              {newSecret.value}
            </code>
            <Button size="sm" onClick={copyKey}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      <Panel label="Generate a key">
        <PanelTitle>Generate a key</PanelTitle>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <Label htmlFor="key-name">Key name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === 'webhook' ? 'e.g. Partnerships form' : 'e.g. Website intake form'
              }
              required
            />
          </div>
          <div className="min-w-56">
            <Label htmlFor="key-kind">Where it will be used</Label>
            <Select
              id="key-kind"
              value={kind}
              onChange={(value) => setKind(value as KeyKind)}
              options={[
                { value: 'secret', label: 'Your own server or integration' },
                { value: 'webhook', label: 'A form platform (Typeform)' },
              ]}
            />
          </div>
          <Button type="submit" disabled={creating}>
            {creating ? 'Generating…' : kind === 'webhook' ? 'Generate address' : 'Generate key'}
          </Button>
        </form>
        <ErrorNote error={error} className="mt-3" />
      </Panel>

      {apiKeys.length > 0 && (
        <Panel label="Keys">
          <PanelTitle
            right={
              <span className="font-display text-label font-medium" style={{ color: C.faint }}>
                {apiKeys.length} {apiKeys.length === 1 ? 'key' : 'keys'}
              </span>
            }
          >
            Keys
          </PanelTitle>
          <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
            <DataTable
              columns={keyColumns}
              rows={keyPage.items}
              rowKey={(k) => k.id}
              rowClassName={(k) => (k.revokedAt ? 'opacity-50' : '')}
            />
          </div>
          <div className="mt-4">
            <Pagination
              page={keyPage.page}
              pageCount={Math.max(1, Math.ceil(keyPage.total / keyPage.pageSize))}
              shown={keyPage.items.length}
              total={keyPage.total}
              noun="keys"
              onChange={setPage}
            />
          </div>
        </Panel>
      )}
    </SettingsPage>
  )
}
