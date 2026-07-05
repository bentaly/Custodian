import { useEffect, useState } from 'react'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { listApplications, getRoundBudgetSummary } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import { DueDiligenceBadge } from '../../components/dueDiligence'
import { CustodianScoreBadge } from '../../components/custodianScore'
import type { CustodianScoreStatus } from '../../lib/custodianScore'
import type { DueDiligenceStatus } from '../../lib/dueDiligence'
import { getRoundStatus, ROUND_STATUS_LABELS, ROUND_STATUS_COLORS } from '../../lib/roundStatus'
import { ApplicationStatus, ScoreBand } from '../../lib/validators/application'
import { Badge, Card, EmptyState, Select } from '../../components/ui'

const PAGE_SIZE = 25

type ApplicationsSearch = {
  roundId?: string
  programmeId?: string
  status?: ApplicationStatus
  scoreBand?: ScoreBand
  tag?: string
  q?: string
  page?: number
}

export const Route = createFileRoute('/_authenticated/applications/')({
  validateSearch: (search: Record<string, unknown>): ApplicationsSearch => {
    const page = Number(search.page)
    return {
      roundId: typeof search.roundId === 'string' ? search.roundId : undefined,
      programmeId: typeof search.programmeId === 'string' ? search.programmeId : undefined,
      status: ApplicationStatus.optional().catch(undefined).parse(search.status),
      scoreBand: ScoreBand.optional().catch(undefined).parse(search.scoreBand),
      tag: typeof search.tag === 'string' && search.tag ? search.tag : undefined,
      q: typeof search.q === 'string' && search.q ? search.q : undefined,
      page: Number.isInteger(page) && page > 1 ? page : undefined,
    }
  },
  loaderDeps: ({ search }) => ({
    roundId: search.roundId,
    programmeId: search.programmeId,
    status: search.status,
    scoreBand: search.scoreBand,
    tag: search.tag,
    q: search.q,
    page: search.page,
  }),
  loader: async ({ deps }) => {
    const rounds = await listMyRounds()

    // Default to the most recent non-upcoming round when no roundId is in the URL
    let roundId = deps.roundId
    if (!roundId) {
      const candidate = rounds
        .filter((r) => getRoundStatus(r) !== 'upcoming')
        .sort((a, b) => {
          const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
          const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
          return bT - aT
        })[0]
      if (candidate) throw redirect({ to: '/applications', search: { roundId: candidate.id } })
    }

    const [applicationsData, budgetSummary] = await Promise.all([
      listApplications({
        data: {
          page: deps.page ?? 1,
          pageSize: PAGE_SIZE,
          roundId,
          programmeId: deps.programmeId,
          status: deps.status,
          scoreBand: deps.scoreBand,
          tag: deps.tag,
          q: deps.q,
        },
      }),
      roundId ? getRoundBudgetSummary({ data: { roundId } }) : Promise.resolve([]),
    ])
    return { ...applicationsData, rounds, budgetSummary }
  },
  component: ApplicationsList,
})

function formatDate(date: Date | string | null | undefined) {
  if (!date) return null
  return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_TABS: Array<{ value: ApplicationStatus | undefined; label: string }> = [
  { value: undefined, label: 'All' },
  { value: 'for_review', label: 'For review' },
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'awarded', label: 'Awarded' },
  { value: 'declined', label: 'Declined' },
]

const SCORE_BANDS: Array<{ value: ScoreBand; label: string }> = [
  { value: '90plus', label: '90+' },
  { value: '80to89', label: '80–89' },
  { value: '70to79', label: '70–79' },
  { value: 'below70', label: '<70' },
]

const STATUS_LABELS: Record<string, string> = {
  for_review: 'For review',
  shortlisted: 'Shortlisted',
  awarded: 'Awarded',
  declined: 'Declined',
}

const STATUS_COLORS: Record<string, string> = {
  for_review: 'bg-blue-50 text-blue-700',
  shortlisted: 'bg-purple-50 text-purple-700',
  awarded: 'bg-green-50 text-green-700',
  declined: 'bg-red-50 text-red-600',
}

function fmtAmount(amount: string | null | undefined) {
  if (!amount) return '—'
  const n = parseFloat(amount)
  if (isNaN(n)) return '—'
  return `£${n.toLocaleString('en-GB')}`
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`
  if (n >= 1_000) return `£${Math.round(n / 1_000)}k`
  return `£${Math.round(n).toLocaleString('en-GB')}`
}

type BudgetRow = Awaited<ReturnType<typeof getRoundBudgetSummary>>[number]

function ProgrammeBudgetRow({ row }: { row: BudgetRow }) {
  const hasBudget = row.budget !== null

  if (!hasBudget) {
    return (
      <div className="flex items-center gap-3">
        <span className="w-36 truncate text-xs text-gray-600" title={row.programmeName}>
          {row.programmeName}
        </span>
        <div className="flex-1" />
        <span className="text-xs tabular-nums text-gray-500">
          {row.committed > 0 ? fmtCompact(row.committed) : '—'} committed
        </span>
        <span className="w-24 text-right text-xs text-gray-300">No budget set</span>
      </div>
    )
  }

  const pct = Math.min(100, (row.committed / row.budget!) * 100)
  const remaining = row.budget! - row.committed
  const isOver = remaining < 0
  const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <div className="flex items-center gap-3">
      <span className="w-36 truncate text-xs text-gray-600" title={row.programmeName}>
        {row.programmeName}
      </span>
      <div className="flex-1 overflow-hidden rounded-full bg-gray-100" style={{ height: 5 }}>
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 text-right text-xs tabular-nums text-gray-500">
        {fmtCompact(row.committed)} / {fmtCompact(row.budget!)}
      </span>
      <span className={`w-24 text-right text-xs tabular-nums ${isOver ? 'font-medium text-red-500' : 'text-gray-400'}`}>
        {isOver ? `${fmtCompact(-remaining)} over` : `${fmtCompact(remaining)} left`}
      </span>
    </div>
  )
}

function BudgetPanel({ rows }: { rows: BudgetRow[] }) {
  if (rows.length === 0) return null

  const rowsWithBudget = rows.filter((r) => r.budget !== null)
  const hasBudgets = rowsWithBudget.length > 1
  const totalBudget = rowsWithBudget.reduce((s, r) => s + r.budget!, 0)
  const totalCommitted = rows.reduce((s, r) => s + r.committed, 0)
  const totalPct = totalBudget > 0 ? Math.min(100, (totalCommitted / totalBudget) * 100) : 0
  const totalRemaining = totalBudget - totalCommitted
  const isOver = totalRemaining < 0
  const totalBarColor = totalPct >= 100 ? 'bg-red-500' : totalPct >= 80 ? 'bg-amber-400' : 'bg-emerald-500'

  return (
    <Card className="px-5 py-4 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Budget</p>

      {hasBudgets && (
        <div className="flex items-center gap-3 pb-2 border-b border-gray-100">
          <span className="w-36 text-xs font-medium text-gray-500">All programmes</span>
          <div className="flex-1 overflow-hidden rounded-full bg-gray-100" style={{ height: 5 }}>
            <div className={`h-full rounded-full transition-all ${totalBarColor}`} style={{ width: `${totalPct}%` }} />
          </div>
          <span className="w-28 text-right text-xs font-medium tabular-nums text-gray-700">
            {fmtCompact(totalCommitted)} / {fmtCompact(totalBudget)}
          </span>
          <span className={`w-24 text-right text-xs font-medium tabular-nums ${isOver ? 'text-red-500' : 'text-gray-500'}`}>
            {isOver ? `${fmtCompact(-totalRemaining)} over` : `${fmtCompact(totalRemaining)} left`}
          </span>
        </div>
      )}

      <div className="space-y-2.5">
        {rows.map((row) => (
          <ProgrammeBudgetRow key={row.roundProgrammeId} row={row} />
        ))}
      </div>
    </Card>
  )
}

function ApplicationsList() {
  const navigate = useNavigate({ from: '/applications/' })
  const search = Route.useSearch()
  const { roundId, programmeId, status, scoreBand, tag, q, page } = search
  const { items, total, rounds, budgetSummary, statusCounts, allCount } = Route.useLoaderData()

  const currentPage = page ?? 1
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Local, debounced state for the organisation-name search box so typing
  // doesn't fire a loader request (and lose input focus) on every keystroke.
  const [searchTerm, setSearchTerm] = useState(q ?? '')
  useEffect(() => {
    setSearchTerm(q ?? '')
  }, [q])
  useEffect(() => {
    const next = searchTerm.trim() || undefined
    if (next === (q ?? undefined)) return
    const t = setTimeout(() => {
      navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }) })
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
  const roundStatus = selectedRound ? getRoundStatus(selectedRound) : null
  const programmes = selectedRound
    ? selectedRound.roundProgrammes.map((rp) => rp.programme)
    : []
  // Distinct tags across the round's programmes, for the tag/theme filter.
  const tags = [
    ...new Set(programmes.flatMap((p) => (p.tags as string[] | null) ?? [])),
  ].sort()

  function handleRoundChange(e: React.ChangeEvent<HTMLSelectElement>) {
    // Changing round invalidates the programme + tag filters (both are per-round).
    navigate({ search: (prev) => ({ ...prev, roundId: e.target.value || undefined, programmeId: undefined, tag: undefined, page: undefined }) })
  }

  function setProgramme(id: string | undefined) {
    navigate({ search: (prev) => ({ ...prev, programmeId: prev.programmeId === id ? undefined : id, page: undefined }) })
  }

  function setStatus(value: ApplicationStatus | undefined) {
    navigate({ search: (prev) => ({ ...prev, status: value, page: undefined }) })
  }

  function setScoreBand(value: ScoreBand) {
    navigate({ search: (prev) => ({ ...prev, scoreBand: prev.scoreBand === value ? undefined : value, page: undefined }) })
  }

  function setTag(value: string) {
    navigate({ search: (prev) => ({ ...prev, tag: prev.tag === value ? undefined : value, page: undefined }) })
  }

  function goToPage(p: number) {
    navigate({ search: (prev) => ({ ...prev, page: p > 1 ? p : undefined }) })
  }

  const pillBase = 'rounded-full border px-3 py-1 text-xs transition-colors'
  const pillOn = 'border-emerald-600 bg-emerald-50 font-medium text-emerald-700'
  const pillOff = 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Applications</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <span>{total} application{total !== 1 ? 's' : ''}</span>
            {selectedRound && roundStatus && (
              <>
                <span className="text-gray-300">·</span>
                <Badge className={ROUND_STATUS_COLORS[roundStatus]}>
                  {ROUND_STATUS_LABELS[roundStatus]}
                </Badge>
                <span className="text-gray-500">
                  {roundStatus === 'upcoming' ? 'Opens' : 'Opened'} {formatDate(selectedRound.openedAt) ?? '—'}
                  {' · '}
                  {roundStatus === 'closed' ? 'Closed' : 'Closes'} {formatDate(selectedRound.closedAt) ?? '—'}
                </span>
              </>
            )}
          </p>
        </div>
        {visibleRounds.length > 0 && (
          <Select value={roundId ?? ''} onChange={handleRoundChange}>
            {visibleRounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{getRoundStatus(r) === 'open' ? ' (current)' : ''}
              </option>
            ))}
          </Select>
        )}
      </div>

      {budgetSummary.length > 0 && <BudgetPanel rows={budgetSummary} />}

      {/* Status tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100">
        {STATUS_TABS.map((tab) => {
          const cnt = tab.value === undefined ? allCount : (statusCounts[tab.value] ?? 0)
          const on = status === tab.value
          return (
            <button
              key={tab.label}
              onClick={() => setStatus(tab.value)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                on
                  ? 'border-gray-900 font-medium text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {cnt > 0 && <span className="ml-1 text-xs text-gray-400">({cnt})</span>}
            </button>
          )
        })}
      </div>

      {/* Filters: search, programme, AI score */}
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

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">AI score</span>
          {SCORE_BANDS.map((b) => (
            <button
              key={b.value}
              onClick={() => setScoreBand(b.value)}
              className={`${pillBase} ${scoreBand === b.value ? pillOn : pillOff}`}
            >
              {b.label}
            </button>
          ))}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Tag</span>
            {tags.map((t) => (
              <button
                key={t}
                onClick={() => setTag(t)}
                className={`${pillBase} ${tag === t ? pillOn : pillOff}`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState>
          <p className="text-sm text-gray-500">No applications match these filters.</p>
        </EmptyState>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Organisation</th>
                <th className="px-5 py-3">Amount</th>
                <th className="px-5 py-3">Programme</th>
                <th className="px-5 py-3">AI score</th>
                <th className="px-5 py-3">Tags</th>
                <th className="px-5 py-3">Due diligence</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((app) => (
                <tr key={app.id} className="relative transition-colors hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">
                    <Link
                      to="/applications/$applicationId"
                      params={{ applicationId: app.id }}
                      className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded focus-visible:after:ring-2 focus-visible:after:ring-gray-400"
                    >
                      {app.organisationName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{fmtAmount(app.amountRequested)}</td>
                  <td className="px-5 py-3 text-gray-600">{app.roundProgramme?.programme?.name ?? '—'}</td>
                  <td className="px-5 py-3">
                    <CustodianScoreBadge
                      status={(app.custodianScoreStatus ?? 'pending') as CustodianScoreStatus}
                      score={app.custodianScore}
                    />
                  </td>
                  <td className="px-5 py-3">
                    {app.roundProgramme?.programme?.tags && (app.roundProgramme.programme.tags as string[]).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(app.roundProgramme.programme.tags as string[]).map((t) => (
                          <span
                            key={t}
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              tag === t ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <DueDiligenceBadge status={(app.dueDiligenceStatus ?? 'pending') as DueDiligenceStatus} />
                  </td>
                  <td className="px-5 py-3">
                    <Badge className={STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600'}>
                      {STATUS_LABELS[app.status] ?? app.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {total > 0 && pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="tabular-nums text-gray-400">
              Page {currentPage} of {pageCount}
            </span>
            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
