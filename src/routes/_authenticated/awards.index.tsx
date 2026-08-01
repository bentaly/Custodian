import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { BankIcon, Calendar03Icon, Coins01Icon, Target01Icon } from '@hugeicons/core-free-icons'
import {
  DataTable,
  EmptyState,
  KPI_TINTS,
  MiniKpi,
  Select,
  StatusPill,
  type TableColumn,
} from '../../components/ui'
import { listAwards } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import { getRoundStatus } from '../../lib/roundStatus'
import { fmtCompact, fmtDate, fmtMoney } from '../../lib/format'

type AwardItem = ReturnType<typeof Route.useLoaderData>['items'][number]

type AwardsSearch = {
  roundId?: string
  programmeId?: string
  tag?: string
  q?: string
}

export const Route = createFileRoute('/_authenticated/awards/')({
  validateSearch: (search: Record<string, unknown>): AwardsSearch => ({
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
    const [awardsData, rounds] = await Promise.all([
      listAwards({
        data: {
          roundId: deps.roundId,
          programmeId: deps.programmeId,
          tag: deps.tag,
          q: deps.q,
        },
      }),
      listMyRounds(),
    ])
    return { ...awardsData, rounds }
  },
  component: AwardsPage,
})

const GRANT_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Done',
  cancelled: 'Cancelled',
}

const GRANT_STATUS_HEX: Record<string, string> = {
  active: '#31A650',
  completed: '#637083',
  cancelled: '#FF4242',
}

const txtInk = 'font-display text-[14px] text-[#141C24]'
const txtSub = 'font-display text-[14px] text-[#637083]'

const AWARD_COLUMNS: TableColumn<AwardItem>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    cell: (g) => (
      <Link
        to="/awards/$awardId"
        params={{ awardId: g.awardId }}
        onClick={(e) => e.stopPropagation()}
        className="font-display text-[14px] font-medium text-[#141C24] hover:underline"
      >
        {g.organisationName}
      </Link>
    ),
  },
  {
    id: 'programme',
    hideBelow: 'lg',
    header: 'Programme',
    cell: (g) => <span className={txtSub}>{g.programmeName ?? '—'}</span>,
  },
  {
    id: 'round',
    hideBelow: 'xl',
    header: 'Round',
    cell: (g) => <span className={txtSub}>{g.roundName ?? '—'}</span>,
  },
  {
    id: 'awarded',
    hideBelow: 'lg',
    header: 'Awarded',
    cell: (g) => <span className={`whitespace-nowrap ${txtSub}`}>{fmtDate(g.decisionAt)}</span>,
  },
  {
    id: 'amount',
    header: 'Amount',
    cellClassName: 'tabular-nums',
    cell: (g) => (
      <span className="whitespace-nowrap font-display text-[14px] font-medium text-[#141C24]">
        {fmtMoney(g.amountAwarded)}
      </span>
    ),
  },
  {
    id: 'paid',
    hideBelow: 'md',
    header: 'Paid',
    cell: (g) =>
      g.instalmentCount === 0 ? (
        <span className={txtSub}>—</span>
      ) : (
        <span
          className={`whitespace-nowrap ${txtSub}`}
          title={`${g.paidCount} of ${g.instalmentCount} instalments paid`}
        >
          {fmtCompact(g.paidToDate)} <span className="text-[#97A1AF]">/ {g.instalmentCount}</span>
        </span>
      ),
  },
  {
    id: 'duration',
    hideBelow: 'xl',
    header: 'Duration',
    cell: (g) => (
      <span className={`whitespace-nowrap ${txtSub}`}>
        {g.durationYears ? `${g.durationYears} yr${g.durationYears > 1 ? 's' : ''}` : '—'}
      </span>
    ),
  },
  {
    id: 'geography',
    hideBelow: 'xl',
    header: 'Geography',
    cell: (g) => <span className={`whitespace-nowrap ${txtSub}`}>{g.deliveryArea ?? '—'}</span>,
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[120px]',
    cell: (g) => (
      <StatusPill
        label={GRANT_STATUS_LABELS[g.status] ?? g.status}
        color={GRANT_STATUS_HEX[g.status] ?? '#637083'}
      />
    ),
  },
]

type ProgrammeShare = { name: string; amount: number }
type Totals = ReturnType<typeof Route.useLoaderData>['totals']

function StatCards({ totals }: { totals: Totals }) {
  const top: ProgrammeShare[] = totals.byProgramme.slice(0, 3)
  const topTotal = top.reduce((s: number, p: ProgrammeShare) => s + p.amount, 0)
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MiniKpi
        tint={KPI_TINTS.violet}
        icon={Coins01Icon}
        label="Total awarded"
        value={fmtMoney(totals.totalAwarded)}
        sub={`${totals.count} award${totals.count !== 1 ? 's' : ''}`}
      />
      <MiniKpi
        tint={KPI_TINTS.green}
        icon={BankIcon}
        label="Paid to date"
        value={fmtMoney(totals.paidToDate)}
        sub={`${fmtMoney(totals.outstanding)} outstanding`}
      />
      <MiniKpi
        tint={KPI_TINTS.amber}
        icon={Calendar03Icon}
        label="Multi-year"
        value={String(totals.multiYearCount)}
        sub="awards running over 1 year"
      />
      <MiniKpi
        tint={KPI_TINTS.pink}
        icon={Target01Icon}
        label="By programme"
        value={top[0] ? top[0].name : '—'}
        sub={top[0] ? `${fmtCompact(top[0].amount)} · largest share` : 'no awards yet'}
      >
        {top.length > 0 && (
          <div className="mt-3 space-y-1">
            {top.map((p: ProgrammeShare) => {
              const pct = topTotal > 0 ? Math.round((p.amount / topTotal) * 100) : 0
              return (
                <div key={p.name}>
                  <div className="flex justify-between text-[11px]">
                    <span className="truncate text-gray-500" title={p.name}>
                      {p.name}
                    </span>
                    <span className="ml-2 shrink-0 font-medium text-gray-700">
                      {fmtCompact(p.amount)}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-white/70">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: KPI_TINTS.pink.accent }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </MiniKpi>
    </div>
  )
}

function AwardsPage() {
  const navigate = Route.useNavigate()
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
      search: (prev) => ({
        ...prev,
        roundId: e.target.value || undefined,
        programmeId: undefined,
        tag: undefined,
      }),
    })
  }

  function setProgramme(id: string | undefined) {
    navigate({
      search: (prev) => ({ ...prev, programmeId: prev.programmeId === id ? undefined : id }),
    })
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
          <h1 className="font-display text-[21px] font-semibold text-gray-900">Awards</h1>
          <p className="mt-0.5 text-sm text-gray-400">Every award made, across all rounds</p>
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
          className="w-56 rounded-sm border border-gray-200 px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-gray-400"
        />

        {programmes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Programme
            </span>
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
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Tag
            </span>
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
          <p className="text-sm text-gray-500">No awards match these filters.</p>
          <p className="mt-1 text-xs text-gray-400">
            Awards appear here as soon as one is generated after the trustee vote.
          </p>
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-[#E4E7EC] bg-white">
          <DataTable
            columns={AWARD_COLUMNS}
            rows={items}
            rowKey={(g) => g.awardId}
            onRowClick={(g) => navigate({ to: '/awards/$awardId', params: { awardId: g.awardId } })}
          />
        </div>
      )}
    </div>
  )
}
