import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { listAwards } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import { AwardSetupDrawer } from '../../components/AwardSetupDrawer'
import { getRoundStatus } from '../../lib/roundStatus'

export const Route = createFileRoute('/_authenticated/awards')({
  validateSearch: (search: Record<string, unknown>) => ({
    roundId: typeof search.roundId === 'string' ? search.roundId : (undefined as string | undefined),
  }),
  loaderDeps: ({ search }) => ({ roundId: search.roundId }),
  loader: async ({ deps }) => {
    const [awards, rounds] = await Promise.all([
      listAwards({ data: { roundId: deps.roundId } }),
      listMyRounds(),
    ])
    return { awards, rounds }
  },
  component: AwardsPage,
})

function fmt(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function fmtDate(iso: string | null) {
  if (!iso) return 'Date TBC'
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

type Awards = ReturnType<typeof Route.useLoaderData>['awards']

function PendingCard({
  app,
  onSetUp,
}: {
  app: Awards['pending'][number]
  onSetUp: () => void
}) {
  const programme = app.roundProgramme?.programme?.name ?? '—'
  const round = app.roundProgramme?.round?.name
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 px-4 py-3">
      <div className="min-w-0">
        <Link
          to="/applications/$applicationId"
          params={{ applicationId: app.id }}
          className="font-medium text-gray-900 hover:underline"
        >
          {app.organisationName}
        </Link>
        <p className="mt-0.5 truncate text-xs text-gray-400">
          {programme}
          {round ? ` · ${round}` : ''} · Requested {fmt(parseFloat(app.amountRequested))}
        </p>
      </div>
      <button
        onClick={onSetUp}
        className="shrink-0 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
      >
        Set up award →
      </button>
    </div>
  )
}

function ActiveRow({ app }: { app: Awards['active'][number] }) {
  const programme = app.roundProgramme?.programme?.name ?? '—'
  const schedule: Array<{ instalment: number; amount: string; date: string | null }> =
    app.paymentSchedule ?? []
  const awarded = app.amountAwarded ? parseFloat(app.amountAwarded) : null
  return (
    <div className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/applications/$applicationId"
            params={{ applicationId: app.id }}
            className="font-medium text-gray-900 hover:underline"
          >
            {app.organisationName}
          </Link>
          <p className="mt-0.5 truncate text-xs text-gray-400">{programme}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-gray-900">
          {awarded !== null ? fmt(awarded) : '—'}
        </span>
      </div>
      {schedule.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {schedule.map((s) => (
            <span
              key={s.instalment}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
            >
              #{s.instalment} · {fmt(parseFloat(s.amount))} · {fmtDate(s.date)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function AwardsPage() {
  const navigate = useNavigate({ from: '/awards' })
  const router = useRouter()
  const { roundId } = Route.useSearch()
  const { awards, rounds } = Route.useLoaderData()

  // Keep the application mounted through the close transition (see shortlist).
  const [setupApp, setSetupApp] = useState<Awards['pending'][number] | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  function openSetup(app: Awards['pending'][number]) {
    setSetupApp(app)
    requestAnimationFrame(() => setDrawerOpen(true))
  }

  async function handleAwarded() {
    setDrawerOpen(false)
    await router.invalidate()
  }

  const visibleRounds = rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aDate = a.closedAt ? new Date(a.closedAt).getTime() : Infinity
      const bDate = b.closedAt ? new Date(b.closedAt).getTime() : Infinity
      return bDate - aDate
    })

  const totalAwarded = awards.active.reduce(
    (sum, a) => sum + (a.amountAwarded ? parseFloat(a.amountAwarded) : 0),
    0,
  )

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    navigate({ search: { roundId: e.target.value || undefined } })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1
            style={{ fontFamily: "'DM Serif Display', serif", fontSize: 21, fontWeight: 400 }}
            className="text-gray-900"
          >
            Awards
          </h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {awards.pending.length} pending setup · {awards.active.length} active
            {totalAwarded > 0 && ` · ${fmt(totalAwarded)} awarded`}
          </p>
        </div>
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
                {getRoundStatus(r) === 'open'
                  ? ' (current)'
                  : getRoundStatus(r) === 'closed'
                    ? ' (closed)'
                    : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {awards.pending.length === 0 && awards.active.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-gray-500">No awards yet</p>
          <p className="mt-1 text-xs text-gray-400">
            Shortlist an application, then set up its award here.
          </p>
          <Link
            to="/shortlist"
            search={{ roundId: undefined }}
            className="mt-4 inline-block rounded border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Go to Shortlist →
          </Link>
        </div>
      )}

      {awards.pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Pending setup
          </h2>
          <div className="space-y-2">
            {awards.pending.map((app) => (
              <PendingCard key={app.id} app={app} onSetUp={() => openSetup(app)} />
            ))}
          </div>
        </section>
      )}

      {awards.active.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Active awards
          </h2>
          <div className="space-y-2">
            {awards.active.map((app) => (
              <ActiveRow key={app.id} app={app} />
            ))}
          </div>
        </section>
      )}

      {setupApp && (
        <AwardSetupDrawer
          application={setupApp}
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onAwarded={handleAwarded}
        />
      )}
    </div>
  )
}
