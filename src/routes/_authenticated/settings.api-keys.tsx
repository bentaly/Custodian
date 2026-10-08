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
//
// One token, THREE addresses: the token says which foundation, the address says whether
// the form is an application form, a report form or an expression of interest form. All
// are shown at once because the token is shown once; a foundation uses whichever it has.
//
// The PLATFORM is chosen only to print addresses with its name in. The token is the
// same kind for every platform and the server reads the delivery by its shape, so
// nothing is stored about it. Expressions of interest have a Typeform address only.
type Platform = 'typeform' | 'formstack'

const PLATFORM_LABEL: Record<Platform, string> = {
  typeform: 'Typeform',
  formstack: 'Formstack',
}

// Where the address goes, in the platform's own words.
const PLATFORM_WHERE: Record<Platform, string> = {
  typeform: 'In Typeform, Connect → Webhooks → Add a webhook.',
  formstack:
    "In Formstack, the form's Settings → Emails & Actions → Add Webhook, with the content type set to JSON. Leave the shared secret blank: the address is the key.",
}

function webhookUrls(platform: Platform, token: string) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return {
    application: `${origin}/api/webhooks/${platform}/${token}`,
    report: `${origin}/api/webhooks/${platform}-report/${token}`,
    eoi: platform === 'typeform' ? `${origin}/api/webhooks/typeform-eoi/${token}` : null,
  }
}

type Revealed =
  | { kind: 'secret'; key: string }
  | {
      kind: 'webhook'
      platform: Platform
      application: string
      report: string
      eoi: string | null
    }

// What the "Where it will be used" select offers: our own server, or a platform.
type KeyUse = 'secret' | Platform

function ApiKeys() {
  const router = useRouter()
  const { features } = Route.useRouteContext().user
  const { apiKeys } = Route.useLoaderData()
  // Same paged contract as every other table, from the loaded set — see
  // `settings/team` for why the page number stays out of the URL here.
  const [page, setPage] = useState(1)
  const keyPage = paginate(apiKeys, page)
  const [name, setName] = useState('')
  const [use, setUse] = useState<KeyUse>('secret')
  const kind: KeyKind = use === 'secret' ? 'secret' : 'webhook'
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [newSecret, setNewSecret] = useState<Revealed | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setNewSecret(null)
    setCreating(true)
    try {
      const created = await createApiKey({ data: { name, kind } })
      setNewSecret(
        use === 'secret'
          ? { kind: 'secret', key: created.key }
          : { kind: 'webhook', platform: use, ...webhookUrls(use, created.key) },
      )
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

  async function copy(value: string) {
    await navigator.clipboard.writeText(value)
    setCopied(value)
    setTimeout(() => setCopied(null), 2000)
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
        See the <TextLink to="/settings/submissions">Submission guide</TextLink> for the endpoints
        and the fields we expect.
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
              ? "Webhook address created. Copy it now. You won't be able to see it again."
              : "Key created. Copy it now. You won't be able to see it again."}
          </p>
          {newSecret.kind === 'webhook' ? (
            <>
              <p className="mt-1 font-display text-label" style={{ color: C.sub }}>
                Paste the address for the kind of form into that form's webhook settings.{' '}
                {PLATFORM_WHERE[newSecret.platform]} Every address contains the key, so treat them
                like one.
              </p>
              <RevealedValue
                label="For an application form"
                value={newSecret.application}
                copied={copied === newSecret.application}
                onCopy={copy}
              />
              <RevealedValue
                label="For a grant report form"
                value={newSecret.report}
                copied={copied === newSecret.report}
                onCopy={copy}
              />
              {/* Behind the `sourcing` flag (`lib/features.ts`): the address 404s
                  on production until expressions of interest ship there. */}
              {features.sourcing && newSecret.eoi && (
                <RevealedValue
                  label="For an expression of interest form"
                  value={newSecret.eoi}
                  copied={copied === newSecret.eoi}
                  onCopy={copy}
                />
              )}
            </>
          ) : (
            <RevealedValue value={newSecret.key} copied={copied === newSecret.key} onCopy={copy} />
          )}
        </div>
      )}

      {/* How an invitation's link finds its way back. Here, with the addresses a form
          is connected by, rather than in every send dialog: it is set up once, on the
          foundation's own form, by whoever builds it. Moved out of the dialog on
          2026-10-06. */}
      {features.sourcing && (
        <Panel label="Invitations from Partnerships and EOIs">
          <PanelTitle>Invitations from Partnerships and expressions of interest</PanelTitle>
          <p className="font-display text-body" style={{ color: C.sub }}>
            When Custodian emails an invitation to apply or to send an expression of interest, it
            adds a reference to the link to your form. Give your form a hidden field called{' '}
            <code className="font-mono">custodian_ref</code> and what comes back is tied to the
            partnership or expression of interest that prompted it. Without it, submissions still
            arrive and can be linked by hand.
          </p>
        </Panel>
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
              value={use}
              onChange={(value) => setUse(value as KeyUse)}
              options={[
                { value: 'secret', label: 'Your own server or integration' },
                { value: 'typeform', label: `A form platform (${PLATFORM_LABEL.typeform})` },
                { value: 'formstack', label: `A form platform (${PLATFORM_LABEL.formstack})` },
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

function RevealedValue({
  label,
  value,
  copied,
  onCopy,
}: {
  label?: string
  value: string
  copied: boolean
  onCopy: (value: string) => void
}) {
  return (
    <div className="mt-3 flex flex-col gap-1">
      {label && (
        <p className="font-display text-label font-medium" style={{ color: C.ink }}>
          {label}
        </p>
      )}
      <div className="flex items-center gap-2">
        <code
          className="flex-1 overflow-x-auto rounded-chip border bg-white px-3 py-2 font-mono text-label"
          style={{ borderColor: C.brandBorder, color: C.ink }}
        >
          {value}
        </code>
        <Button size="sm" onClick={() => onCopy(value)}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  )
}
