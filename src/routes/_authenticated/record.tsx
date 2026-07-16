import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge, Card, EmptyState, Select } from '../../components/ui'
import { listGrantRecord } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import { getRoundStatus } from '../../lib/roundStatus'

type RecordSearch = {
  roundId?: string
  programmeId?: string
  tag?: string
  q?: string
}

export const Route = createFileRoute('/_authenticated/record')({
  validateSearch: (search: Record<string, unknown>): RecordSearch => ({
    roundId: typeof search.roundId === 'string' ? search.roundId : undefined,
    programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
    tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
    q: typeof search.q === 'string' && search.q ? search.q : undefined,
  }),
  loaderDeps: ({ search }) => ({
    roundId: search.roundId,
    programmeId: search.programmeId,
    tag: search.tag,
    q: search.q,
  }),
  loader: async ({ deps }) => {
    const [record, rounds] = await Promise.all([
      listGrantRecord({
        data: {
          roundId: deps.roundId,
          programmeId: deps.programmeId,
          tag: deps.tag,
          q: deps.q,
        },
      }),
      listMyRounds(),
    ])
    return { ...record, rounds }
  },
  component: RecordPage,
})

function fmt(n: number) {
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

function fmtDate(date: Date | string | null | undefined) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const GRANT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Complete',
  cancelled: 'Cancelled',
}

const GRANT_STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-50 text-red-600',
}

type ProgrammeShare = { name: string; amount: number }
type Totals = ReturnType<typeof Route.useLoaderData>['totals']

function StatCards({ totals }: { totals: Totals }) {
  const top: ProgrammeShare[] = totals.byProgramme.slice(0, 4)
  const topTotal = top.reduce((s: number, p: ProgrammeShare) => s + p.amount, 0)
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Total awarded</p>
        <p className="mt-1 text-xl font-semibold text-gray-900">{fmt(totals.totalAwarded)}</p>
        <p className="mt-0.5 text-xs text-gray-400">
          {totals.count} grant{totals.count !== 1 ? 's' : ''}
        </p>
      </Card>
      <Card className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Paid to date</p>
        <p className="mt-1 text-xl font-semibold text-gray-900">{fmt(totals.paidToDate)}</p>
        <p className="mt-0.5 text-xs text-gray-400">{fmt(totals.outstanding)} outstanding</p>
      </Card>
      <Card className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Multi-year</p>
        <p className="mt-1 text-xl font-semibold text-gray-900">{totals.multiYearCount}</p>
        <p className="mt-0.5 text-xs text-gray-400">Grants over 1 year</p>
      </Card>
      <Card className="px-4 py-3">
        <p className="mb-1.5 text-[11px] uppercase tracking-wide text-gray-400">By programme</p>
        {top.length === 0 ? (
          <p className="text-xs text-gray-400">—</p>
        ) : (
          <div className="space-y-1">
            {top.map((p: ProgrammeShare) => {
              const pct = topTotal > 0 ? Math.round((p.amount / topTotal) * 100) : 0
              return (
                <div key={p.name}>
                  <div className="flex justify-between text-[11px]">
                    <span className="truncate text-gray-500" title={p.name}>
                      {p.name}
                    </span>
                    <span className="ml-2 shrink-0 font-medium text-gray-700">{fmtCompact(p.amount)}</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function RecordPage() {
  const navigate = useNavigate({ from: '/record' })
  const search = Route.useSearch()
  const { roundId, programmeId, tag, q } = search
  const { items, totals, rounds } = Route.useLoaderData()

  // Debounced org-name search, mirroring the Applications list.
  const [searchTerm, setSearchTerm] = useState(q ?? '')
  useEffect(() => {
    setSearchTerm(q ?? '')
  }, [q])
  useEffect(() => {
    const next = searchTerm.trim() || undefined
    if (next === (q ?? undefined)) return
    const t = setTimeout(() => {
      navigate({ search: (prev) => ({ ...prev, q: next }) })
    }, 300)
    return () => clearTimeout(t)
  }, [searchTerm]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRounds = rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
      const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
      return bT - aT
    })

  const selectedRound = rounds.find((r) => r.id === roundId)
  const programmes = selectedRound ? selectedRound.roundProgrammes.map((rp) => rp.programme) : []
  const tags = [...new Set(programmes.flatMap((p) => (p.tags as string[] | null) ?? []))].sort()

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    navigate({
      search: (prev) => ({ ...prev, roundId: e.target.value || undefined, programmeId: undefined, tag: undefined }),
    })
  }

  function setProgramme(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, programmeId: prev.programmeId === id ? undefined : id }) })
  }

  function setTag(value: string) {
    navigate({ search: (prev) => ({ ...prev, tag: prev.tag === value ? undefined : value }) })
  }

  const pillBase = 'rounded-full border px-3 py-1 text-xs transition-colors'
  const pillOn = 'border-emerald-600 bg-emerald-50 font-medium text-emerald-700'
  const pillOff = 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1
            className="font-display text-[21px] font-semibold text-gray-900"
          >
            Record
          </h1>
          <p className="mt-0.5 text-sm text-gray-400">Every grant awarded, across all rounds</p>
        </div>
        {visibleRounds.length > 0 && (
          <Select value={roundId ?? ''} onChange={handleRoundChange}>
            <option value="">All rounds</option>
            {visibleRounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {getRoundStatus(r) === 'open' ? ' (current)' : ''}
              </option>
            ))}
          </Select>
        )}
      </div>

      <StatCards totals={totals} />

      {/* Filters: search, programme (per selected round), tag */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search organisation…"
          className="w-56 rounded border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
        />

        {programmes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Programme</span>
            <button
              onClick={() => setProgramme(undefined)}
              className={`${pillBase} ${programmeId === undefined ? pillOn : pillOff}`}
            >
              All
            </button>
            {programmes.map((p) => (
              <button
                key={p.id}
                onClick={() => setProgramme(p.id)}
                className={`${pillBase} ${programmeId === p.id ? pillOn : pillOff}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Tag</span>
            {tags.map((t) => (
              <button key={t} onClick={() => setTag(t)} className={`${pillBase} ${tag === t ? pillOn : pillOff}`}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState>
          <p className="text-sm text-gray-500">No grants match these filters.</p>
          <p className="mt-1 text-xs text-gray-400">
            Grants appear here as soon as an award is generated after the trustee vote.
          </p>
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3">Programme</th>
                <th className="px-5 py-3">Round</th>
                <th className="px-5 py-3">Awarded</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Paid</th>
                <th className="px-5 py-3">Duration</th>
                <th className="px-5 py-3">Geography</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((g) => (
                <tr key={g.grantId} className="relative transition-colors hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    <Link
                      to="/applications/$applicationId"
                      params={{ applicationId: g.applicationId }}
                      className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded focus-visible:after:ring-2 focus-visible:after:ring-gray-400"
                    >
                      {g.organisationName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{g.programmeName ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{g.roundName ?? '—'}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">{fmtDate(g.decisionAt)}</td>
                  <td className="px-5 py-3 whitespace-nowrap font-medium text-gray-900">{fmt(g.amountAwarded)}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">
                    {g.instalmentCount === 0 ? (
                      '—'
                    ) : (
                      <span title={`${g.paidCount} of ${g.instalmentCount} instalments paid`}>
                        {fmtCompact(g.paidToDate)}{' '}
                        <span className="text-gray-400">/ {g.instalmentCount}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">
                    {g.durationYears ? `${g.durationYears} yr${g.durationYears > 1 ? 's' : ''}` : '—'}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">{g.deliveryArea ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge className={GRANT_STATUS_COLORS[g.status] ?? 'bg-gray-100 text-gray-600'}>
                      {GRANT_STATUS_LABELS[g.status] ?? g.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
