import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { listShortlist } from '../../server/fns/shortlist'
import { listMyRounds } from '../../server/fns/rounds'
import { updateApplicationStatus } from '../../server/fns/applications'
import { ApplicationDrawer } from '../../components/ApplicationDrawer'
import { BriefingDrawer } from '../../components/BriefingDrawer'
import { getRoundStatus } from '../../lib/roundStatus'
import type { CustodianScoreDetail } from '../../lib/custodianScore'

export const Route = createFileRoute('/_authenticated/shortlist')({
  validateSearch: (search: Record<string, unknown>) => ({
    roundId: typeof search.roundId === 'string' ? search.roundId : (undefined as string | undefined),
  }),
  loaderDeps: ({ search }) => ({ roundId: search.roundId }),
  loader: async ({ deps }) => {
    const [items, rounds] = await Promise.all([
      listShortlist({ data: { roundId: deps.roundId } }),
      listMyRounds(),
    ])
    return { items, rounds }
  },
  component: ShortlistPage,
})

function fmt(n: number) {
  return `£${n.toLocaleString('en-GB')}`
}

function scoreColor(score: number) {
  if (score >= 80) return '#0F6E56'
  if (score >= 60) return '#854F0B'
  return '#A32D2D'
}

function scoreBg(score: number) {
  if (score >= 80) return '#E1F5EE'
  if (score >= 60) return '#FAEEDA'
  return '#FCEBEB'
}

function OrgInitials({ name, score }: { name: string; score: number | null }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  const bg = score && score >= 80 ? '#E1F5EE' : '#f4f4f0'
  const color = score && score >= 80 ? '#085041' : '#555'
  return (
    <div
      style={{ background: bg, color }}
      className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-xs font-semibold"
    >
      {initials}
    </div>
  )
}

function ShortlistCard({
  app,
  onRemove,
  onView,
  onBriefing,
}: {
  app: ReturnType<typeof Route.useLoaderData>['items'][number]
  onRemove: () => void
  onView: () => void
  onBriefing: () => void
}) {
  const [removing, setRemoving] = useState(false)
  const score = app.custodianScore
  const detail = app.custodianScoreDetail as CustodianScoreDetail | null
  const isHighScore = score !== null && score >= 80
  const amount = parseFloat(app.amountRequested)
  const programme = app.roundProgramme?.programme?.name ?? '—'

  async function handleRemove() {
    setRemoving(true)
    try {
      await updateApplicationStatus({ data: { id: app.id, status: 'for_review' } })
      onRemove()
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div
      style={{
        border: isHighScore ? '1.5px solid #1D9E75' : '0.5px solid #e5e5e0',
        borderRadius: 9,
        overflow: 'hidden',
      }}
    >
      {/* Card header */}
      <div className="p-3.5" style={{ borderBottom: '0.5px solid #f0f0ec' }}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <OrgInitials name={app.organisationName} score={score} />
            <Link
              to="/applications/$applicationId"
              params={{ applicationId: app.id }}
              style={{ fontFamily: "'DM Serif Display', serif", fontSize: 15 }}
              className="leading-tight text-gray-900 hover:underline"
            >
              {app.organisationName}
            </Link>
          </div>
          {score !== null && (
            <span
              style={{
                background: scoreBg(score),
                color: scoreColor(score),
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {score}/100
            </span>
          )}
        </div>

        <div className="mb-2 flex flex-wrap gap-1">
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 3,
              background: '#f0f0ec',
              color: '#555',
              fontWeight: 500,
            }}
          >
            {programme}
          </span>
          {app.roundProgramme?.round?.name && (
            <span
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 3,
                background: '#f0f0ec',
                color: '#888',
              }}
            >
              {app.roundProgramme.round.name}
            </span>
          )}
        </div>

        {detail?.summary && (
          <p style={{ fontSize: 12, color: '#555', lineHeight: 1.4 }}>
            {detail.summary.length > 140 ? detail.summary.slice(0, 140) + '…' : detail.summary}
          </p>
        )}
      </div>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          borderBottom: '0.5px solid #f0f0ec',
          padding: '9px 14px',
        }}
      >
        <div>
          <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', marginBottom: 1 }}>
            Requested
          </div>
          <div style={{ fontSize: 12, fontWeight: 500 }}>{fmt(amount)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', marginBottom: 1 }}>
            Custodian score
          </div>
          <div style={{ fontSize: 12, fontWeight: 500 }}>
            {score !== null ? `${score}/100` : '—'}
          </div>
        </div>
      </div>

      {/* Trustee votes → award readiness */}
      {app.hasMajority ? (
        <Link
          to="/awards"
          search={{ roundId: undefined }}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '10px 14px',
            borderBottom: '0.5px solid #f0f0ec',
            background: '#F0FAF6',
            textDecoration: 'none',
          }}
        >
          <span style={{ fontSize: 11, color: '#0F6E56', fontWeight: 600 }}>
            ✓ {app.yesVotes}/{app.trusteeCount} trustees in favour — enough votes
          </span>
          <span style={{ fontSize: 11, color: '#0F6E56', fontWeight: 500, whiteSpace: 'nowrap' }}>
            Go to Awards to set up →
          </span>
        </Link>
      ) : (
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '0.5px solid #f0f0ec',
            fontSize: 11,
            color: '#888',
          }}
        >
          {app.trusteeCount === 0 ? (
            'No trustees to vote'
          ) : (
            <>
              <span style={{ fontWeight: 600, color: '#555' }}>
                {app.yesVotes}/{app.trusteeCount}
              </span>{' '}
              trustees in favour · majority needed to award
            </>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ padding: '11px 14px', display: 'flex', gap: 6 }}>
        <button
          onClick={onBriefing}
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 11,
            padding: '6px 0',
            borderRadius: 5,
            border: '0.5px solid #1D9E75',
            background: '#F0FAF6',
            color: '#0F6E56',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Briefing
        </button>
        <button
          onClick={onView}
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 11,
            padding: '6px 0',
            borderRadius: 5,
            border: '0.5px solid #ddd',
            background: '#fff',
            color: '#555',
            cursor: 'pointer',
          }}
        >
          Application
        </button>
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            flex: 1,
            fontSize: 11,
            padding: '6px 0',
            borderRadius: 5,
            border: '0.5px solid #F7C1C1',
            background: '#FCEBEB',
            color: '#A32D2D',
            cursor: 'pointer',
          }}
        >
          {removing ? '…' : '× Remove'}
        </button>
      </div>
    </div>
  )
}

function ShortlistPage() {
  const navigate = useNavigate({ from: '/shortlist' })
  const router = useRouter()
  const { roundId } = Route.useSearch()
  const { items, rounds } = Route.useLoaderData()
  const { user } = Route.useRouteContext()

  type ShortlistItem = ReturnType<typeof Route.useLoaderData>['items'][number]

  // `viewApp` / `briefingApp` stay set through the close transition so drawers
  // can animate out; the `Open` flags drive the slide.
  const [viewApp, setViewApp] = useState<ShortlistItem | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [briefingApp, setBriefingApp] = useState<ShortlistItem | null>(null)
  const [briefingOpen, setBriefingOpen] = useState(false)

  function openView(app: ShortlistItem) {
    setViewApp(app)
    requestAnimationFrame(() => setDrawerOpen(true))
  }

  function openBriefing(app: ShortlistItem) {
    setBriefingApp(app)
    requestAnimationFrame(() => setBriefingOpen(true))
  }

  const visibleRounds = rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aDate = a.closedAt ? new Date(a.closedAt).getTime() : Infinity
      const bDate = b.closedAt ? new Date(b.closedAt).getTime() : Infinity
      return bDate - aDate
    })

  const selectedRound = rounds.find((r) => r.id === roundId)

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    navigate({ search: { roundId: e.target.value || undefined } })
  }

  async function handleRemoved() {
    await router.invalidate()
  }

  const totalProposed = items.reduce((sum, a) => sum + parseFloat(a.amountRequested), 0)

  // Programme breakdown
  const byProgramme: Record<string, { amount: number; budget: number | null }> = {}
  for (const app of items) {
    const progName = app.roundProgramme?.programme?.name ?? 'Unknown'
    const budget = app.roundProgramme?.budget
      ? parseFloat(app.roundProgramme.budget)
      : null
    if (!byProgramme[progName]) byProgramme[progName] = { amount: 0, budget }
    byProgramme[progName].amount += parseFloat(app.amountRequested)
  }
  const progEntries = Object.entries(byProgramme)

  const hasBudgets = progEntries.some(([, v]) => v.budget !== null)

  const roundLabel = selectedRound
    ? `${selectedRound.name} · Shortlist`
    : 'Shortlist'

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1
            style={{ fontFamily: "'DM Serif Display', serif", fontSize: 21, fontWeight: 400 }}
            className="text-gray-900"
          >
            {roundLabel}
          </h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {items.length} shortlisted
            {items.length > 0 && ` · ${fmt(totalProposed)} proposed`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Summary stat chips */}
          {items.length > 0 && (
            <div className="flex gap-2">
              <div
                style={{ background: '#f7f7f4', borderRadius: 5, padding: '7px 12px', textAlign: 'center' }}
              >
                <div style={{ fontSize: 17, fontWeight: 300 }}>{items.length}</div>
                <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, textTransform: 'uppercase' }}>
                  Shortlisted
                </div>
              </div>
              <div
                style={{ background: '#f7f7f4', borderRadius: 5, padding: '7px 12px', textAlign: 'center' }}
              >
                <div style={{ fontSize: 17, fontWeight: 300 }}>{fmt(totalProposed)}</div>
                <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, textTransform: 'uppercase' }}>
                  Proposed
                </div>
              </div>
            </div>
          )}
          {visibleRounds.length > 0 && (
            <select
              value={roundId ?? ''}
              onChange={handleRoundChange}
              className="rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="">All rounds</option>
              {visibleRounds.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {getRoundStatus(r) === 'open' ? ' (current)' : getRoundStatus(r) === 'closed' ? ' (closed)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-500">No shortlisted applications</p>
          <p className="mt-1 text-xs text-gray-400">
            Open an application and click "Add to shortlist" to add it here.
          </p>
          <Link
            to="/applications"
            search={{ roundId: undefined }}
            className="mt-4 inline-block rounded border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Go to Applications →
          </Link>
        </div>
      )}

      {items.length > 0 && (
        <>
          {/* Programme breakdown */}
          {progEntries.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: hasBudgets ? '1fr 1fr' : '1fr',
                gap: 12,
              }}
            >
              {/* Proposed spend by programme */}
              <div style={{ border: '0.5px solid #e5e5e0', borderRadius: 9, padding: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#888',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: 10,
                  }}
                >
                  Proposed spend · by programme
                </div>
                {progEntries.map(([name, { amount }], i) => (
                  <div
                    key={name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '5px 0',
                      borderBottom: i < progEntries.length - 1 ? '0.5px solid #e5e5e0' : 'none',
                    }}
                  >
                    <span style={{ fontSize: 11, color: '#555' }}>{name}</span>
                    <span style={{ fontSize: 11, fontWeight: 500 }}>{fmt(amount)}</span>
                  </div>
                ))}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                  }}
                >
                  <span style={{ fontSize: 12, color: '#888' }}>Total proposed</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#0F6E56' }}>
                    {fmt(totalProposed)}
                  </span>
                </div>
              </div>

              {/* Budget vs proposed (only when budgets are available) */}
              {hasBudgets && (
                <div style={{ border: '0.5px solid #e5e5e0', borderRadius: 9, padding: 14 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#888',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      marginBottom: 10,
                    }}
                  >
                    Budget · by programme
                  </div>
                  {progEntries.map(([name, { amount, budget }]) =>
                    budget !== null ? (
                      <div key={name} style={{ marginBottom: 8 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 11,
                            marginBottom: 2,
                          }}
                        >
                          <span style={{ color: '#555' }}>{name}</span>
                          <span style={{ fontWeight: 500 }}>
                            {fmt(amount)} / {fmt(budget)}
                          </span>
                        </div>
                        <div
                          style={{
                            height: 4,
                            borderRadius: 2,
                            background: '#f0f0ec',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min(100, (amount / budget) * 100)}%`,
                              background: amount > budget ? '#E53E3E' : '#1D9E75',
                              borderRadius: 2,
                            }}
                          />
                        </div>
                        <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>
                          {fmt(Math.max(0, budget - amount))} remaining
                          {amount > budget && (
                            <span style={{ color: '#A32D2D' }}> · over budget</span>
                          )}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          )}

          {/* Application cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {items.map((app) => (
              <ShortlistCard
                key={app.id}
                app={app}
                onRemove={handleRemoved}
                onView={() => openView(app)}
                onBriefing={() => openBriefing(app)}
              />
            ))}
          </div>
        </>
      )}

      {viewApp && (
        <ApplicationDrawer
          application={viewApp}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      <BriefingDrawer
        application={briefingApp}
        open={briefingOpen}
        onClose={() => setBriefingOpen(false)}
        user={{ id: user.id, role: user.role }}
      />
    </div>
  )
}
