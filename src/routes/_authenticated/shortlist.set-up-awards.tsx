import { createFileRoute, Link, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowRight02Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  MailOpenLoveIcon,
} from '@hugeicons/core-free-icons'
import {
  createAwards,
  getAwardLetterSettings,
  listAwardCandidates,
  type AwardCandidate,
} from '../../server/fns/awardSetup'
import { getRoundBudgetSummary, listAwards } from '../../server/fns/applications'
import { listMyRounds } from '../../server/fns/rounds'
import { AwardWizard } from '../../components/shortlist/AwardWizard'
import { ShortlistHeader } from '../../components/shortlist/ShortlistHeader'
import { getRoundStatus } from '../../lib/roundStatus'
import {
  DataTable,
  EmptyState,
  FilterPill,
  Pagination,
  StatusPill,
  initials,
  type TableColumn,
} from '../../components/ui'
import { facetBy, facetByMany, facetLabel } from '../../lib/facets'
import { fmtCompact, fmtDate, fmtMoney } from '../../lib/format'
import { C as TOKENS } from '../../components/ui/tokens'

const PAGE_SIZE = 25

const C = {
  ...TOKENS,
  bar: 'var(--color-grey-900)', // the dark selection bar
  mint: 'var(--color-brand-light)', // its meta text
}

const SCORE_BANDS = [
  { value: '90plus', label: '90+', min: 90, max: 100 },
  { value: '80to89', label: '80–89', min: 80, max: 89 },
  { value: '70to79', label: '70–79', min: 70, max: 79 },
  { value: 'below70', label: 'Below 70', min: 0, max: 69 },
] as const

/** Rounds a shortlist can exist in — matches the To vote screen's list exactly. */
function selectableRounds<
  T extends { openedAt: Date | string | null; closedAt: Date | string | null },
>(rounds: T[]): T[] {
  return rounds
    .filter((r) => getRoundStatus(r) !== 'upcoming')
    .sort((a, b) => {
      const aT = a.openedAt ? new Date(a.openedAt).getTime() : 0
      const bT = b.openedAt ? new Date(b.openedAt).getTime() : 0
      return bT - aT
    })
}

export const Route = createFileRoute('/_authenticated/shortlist/set-up-awards')({
  validateSearch: (search: Record<string, unknown>) => ({
    roundId:
      typeof search.roundId === 'string' ? search.roundId : (undefined as string | undefined),
  }),
  // Awarding is an admin act — trustees decide, admins commit. Guard the route as well
  // as the server fn so a trustee following a link gets sent back rather than shown a
  // form every button on which will be refused.
  beforeLoad: async ({ context, search }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/shortlist', search: { roundId: search.roundId } })
    if (search.roundId) return
    const fallback = selectableRounds(await listMyRounds())[0]
    if (fallback) {
      throw redirect({ to: '/shortlist/set-up-awards', search: { roundId: fallback.id } })
    }
  },
  loaderDeps: ({ search }) => ({ roundId: search.roundId }),
  loader: async ({ deps }) => {
    const [candidates, letterSettings, rounds, budget, awarded] = await Promise.all([
      listAwardCandidates({ data: { roundId: deps.roundId } }),
      getAwardLetterSettings(),
      listMyRounds(),
      deps.roundId
        ? getRoundBudgetSummary({ data: { roundId: deps.roundId } })
        : Promise.resolve([]),
      // The round's grants, for the table underneath — "what this sitting has already
      // committed" is the question an admin asks between batches.
      listAwards({ data: { roundId: deps.roundId, pageSize: 200 } }),
    ])
    return { candidates, letterSettings, rounds, budget, awarded }
  },
  component: SetUpAwards,
})

// ─── Cells ──────────────────────────────────────────────────────────────────────

function scoreBandColour(score: number) {
  return score >= 80 ? C.success : score >= 60 ? C.amber : C.danger
}

function AiScoreCell({ status, score }: { status: string; score: number | null }) {
  const has = status === 'scored' && score != null
  const color = has ? scoreBandColour(score) : null
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-[3px] w-10 overflow-hidden rounded-full"
        style={{ backgroundColor: C.wash }}
      >
        {has && (
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, score)}%`, backgroundColor: color! }}
          />
        )}
      </div>
      <span className="font-display text-body font-medium" style={{ color: has ? C.ink : C.faint }}>
        {has ? score : '—'}
      </span>
    </div>
  )
}

function OrganisationCell({ name, subline }: { name: string; subline: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex size-10 shrink-0 items-center justify-center rounded-chip"
        style={{ backgroundColor: C.wash }}
      >
        <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
          {initials(name)}
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-body font-medium" style={{ color: C.ink }}>
          {name}
        </p>
        <p className="truncate font-display text-label" style={{ color: C.sub }}>
          {subline || '—'}
        </p>
      </div>
    </div>
  )
}

// No trailing arrow column: the whole row opens the flow, so a chevron would be a
// second affordance for the same click.
const CANDIDATE_COLUMNS: TableColumn<AwardCandidate>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    cell: (c) => (
      <OrganisationCell
        name={c.organisationName}
        subline={[
          c.charityNumber ? 'Reg. charity' : c.companyNumber ? 'Company' : null,
          c.deliveryArea,
          c.externalApplicationId,
        ]
          .filter(Boolean)
          .join(' · ')}
      />
    ),
  },
  {
    id: 'amount',
    header: 'Amount',
    width: 'sm:w-[130px]',
    cellClassName: 'tabular-nums',
    cell: (c) => (
      <span className="font-display text-body font-medium" style={{ color: C.ink }}>
        {fmtMoney(c.amountRequested)}
      </span>
    ),
  },
  {
    id: 'duration',
    header: 'Duration',
    hideBelow: 'md',
    width: 'sm:w-[140px]',
    cell: (c) => (
      <span className="font-display text-body" style={{ color: C.ink }}>
        {c.grantDurationYears ? `Over ${c.grantDurationYears * 12} months` : '—'}
      </span>
    ),
  },
  {
    id: 'programme',
    header: 'Programme',
    hideBelow: 'lg',
    width: 'sm:w-[200px]',
    cell: (c) => (
      <span className="font-display text-body" style={{ color: C.ink }}>
        {c.programmeName}
      </span>
    ),
  },
  {
    id: 'theme',
    header: 'Theme',
    hideBelow: 'xl',
    width: 'sm:w-[160px]',
    cell: (c) =>
      c.tags.length === 0 ? (
        <span className="font-display text-body" style={{ color: C.faint }}>
          —
        </span>
      ) : (
        <span className="font-display text-body" style={{ color: C.sub }}>
          {c.tags[0]}
          {c.tags.length > 1 && <span style={{ color: C.faint }}> +{c.tags.length - 1}</span>}
        </span>
      ),
  },
  {
    id: 'score',
    header: 'AI score',
    hideBelow: 'md',
    width: 'sm:w-[110px]',
    cell: (c) => <AiScoreCell status={c.custodianScoreStatus} score={c.custodianScore} />,
  },
]

type AwardedRow = Awaited<ReturnType<typeof listAwards>>['items'][number]

const AWARDED_COLUMNS: TableColumn<AwardedRow>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    cell: (a) => (
      <OrganisationCell
        name={a.organisationName}
        subline={[a.programmeName, a.deliveryArea].filter(Boolean).join(' · ')}
      />
    ),
  },
  {
    id: 'amount',
    header: 'Awarded',
    width: 'sm:w-[130px]',
    cellClassName: 'tabular-nums',
    cell: (a) => (
      <span className="font-display text-body font-medium" style={{ color: C.ink }}>
        {fmtMoney(a.amountAwarded)}
      </span>
    ),
  },
  {
    id: 'schedule',
    header: 'Schedule',
    hideBelow: 'md',
    width: 'sm:w-[150px]',
    cell: (a) => (
      <span className="font-display text-body" style={{ color: C.sub }}>
        {a.paidCount} of {a.instalmentCount} paid
      </span>
    ),
  },
  {
    id: 'decided',
    header: 'Awarded on',
    hideBelow: 'lg',
    width: 'sm:w-[140px]',
    cell: (a) => (
      <span className="font-display text-body" style={{ color: C.sub }}>
        {fmtDate(a.decisionAt)}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[120px]',
    cell: (a) => (
      <StatusPill
        label={a.status === 'active' ? 'Active' : a.status === 'completed' ? 'Done' : 'Cancelled'}
        colour={a.status === 'cancelled' ? C.danger : a.status === 'completed' ? C.sub : C.brand}
      />
    ),
  },
]

// ─── Screen ─────────────────────────────────────────────────────────────────────

function SetUpAwards() {
  const navigate = useNavigate()
  const router = useRouter()
  const { roundId } = Route.useSearch()
  const { candidates, letterSettings, rounds, budget, awarded } = Route.useLoaderData()

  const [programmeId, setProgrammeId] = useState<string | undefined>()
  const [tag, setTag] = useState<string | undefined>()
  const [scoreBand, setScoreBand] = useState<string | undefined>()
  // The awarded table filters on its own: a programme with grants already committed
  // need not have anything left ready to award, so one shared pill would hide rows
  // under an option the other table never offers.
  const [awardedProgramme, setAwardedProgramme] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [wizardFor, setWizardFor] = useState<AwardCandidate[] | null>(null)
  const [result, setResult] = useState<Awaited<ReturnType<typeof createAwards>> | null>(null)

  const visibleRounds = selectableRounds(rounds)

  const rows = useMemo(() => {
    const band = SCORE_BANDS.find((b) => b.value === scoreBand)
    return candidates.items.filter((c) => {
      if (programmeId && c.programmeId !== programmeId) return false
      if (tag && !c.tags.includes(tag)) return false
      if (band) {
        if (c.custodianScoreStatus !== 'scored' || c.custodianScore == null) return false
        if (c.custodianScore < band.min || c.custodianScore > band.max) return false
      }
      return true
    })
  }, [candidates.items, programmeId, tag, scoreBand])

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const selectedRows = rows.filter((c) => selected.has(c.id))
  const combinedAsk = selectedRows.reduce((s, c) => s + c.amountRequested, 0)
  const totalAsk = rows.reduce((s, c) => s + c.amountRequested, 0)

  // What is left of the round to commit: its budgets, less what it has already awarded.
  const budgetTotal = budget.reduce((s, b) => s + (b.budget ?? 0), 0)
  const awardedTotal = budget.reduce((s, b) => s + b.awarded, 0)
  const leftInRound = budgetTotal - awardedTotal

  // Counted, like every other filter row's options — both tables' rows are all here on
  // the client, so `facetBy` does the same job the list screens hand to the server.
  const programmeOptions = facetBy(candidates.items, (c) => ({
    value: c.programmeId,
    label: c.programmeName,
  })).map((f) => ({ value: f.value, label: facetLabel(f) }))
  const tagOptions = facetByMany(candidates.items, (c) =>
    c.tags.map((t) => ({ value: t, label: t })),
  ).map((f) => ({ value: f.value, label: facetLabel(f) }))

  // Keyed on the name: `listAwards` rows carry the programme's name, not its id.
  const awardedProgrammeOptions = facetBy(awarded.items, (a) =>
    a.programmeName ? { value: a.programmeName, label: a.programmeName } : null,
  ).map((f) => ({ value: f.value, label: facetLabel(f) }))
  const awardedRows = awardedProgramme
    ? awarded.items.filter((a) => a.programmeName === awardedProgramme)
    : awarded.items
  // Totalled from the rows on screen, so the line above the table always describes
  // the table beneath it.
  const awardedTotalShown = awardedRows.reduce((s, a) => s + a.amountAwarded, 0)

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function finish(response: Awaited<ReturnType<typeof createAwards>>) {
    setWizardFor(null)
    setSelected(new Set())
    setResult(response)
    await router.invalidate()
  }

  const failures = result?.results.filter((r) => r.error) ?? []

  return (
    <div className="flex flex-col gap-4">
      <ShortlistHeader
        tab="awards"
        roundId={roundId}
        rounds={visibleRounds}
        toVoteCount={candidates.shortlistedCount}
        readyToAwardCount={candidates.items.length}
        showTabs
      />

      {/* The Awards icon from the sidebar, not a second one for the same idea: this
          banner is the front door to the section the nav calls Awards. */}
      <div
        className="flex items-start gap-3 rounded-card p-4"
        style={{ backgroundColor: C.brandWash }}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-chip bg-white">
          <HugeiconsIcon icon={MailOpenLoveIcon} size={18} color={C.brand} strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-body font-medium" style={{ color: C.ink }}>
            Set up awards
          </p>
          <p className="font-display text-body" style={{ color: C.sub }}>
            Board-approved applications, ready to convert into live, scheduled grants. Trustees do
            not see this tab.
          </p>
        </div>
      </div>

      {result && (
        <div
          className="flex flex-col gap-2 rounded-card border p-4"
          style={{ borderColor: C.brandBorder, backgroundColor: C.brandWash }}
        >
          <p
            className="flex items-center gap-2 font-display text-body font-medium"
            style={{ color: C.brand }}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} strokeWidth={1.8} />
            {result.created === 1 ? 'One grant awarded' : `${result.created} grants awarded`} ·{' '}
            {fmtMoney(result.totalCommitted)} committed
          </p>
          <p className="font-display text-label" style={{ color: C.body }}>
            The award letters are on their way. Each one is saved against its grant, where it can be
            read and resent.
          </p>
          {failures.length > 0 && (
            <ul className="mt-1 space-y-1">
              {failures.map((f) => (
                <li
                  key={f.applicationId}
                  className="font-display text-label"
                  style={{ color: C.danger }}
                >
                  <strong>{f.organisationName}</strong> — {f.error} It is unchanged and still on the
                  shortlist.
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Ready to award ── */}
      <div
        className="flex flex-col gap-4 rounded-card border bg-white p-4"
        style={{ borderColor: C.line }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-display text-title font-medium" style={{ color: C.ink }}>
            Grants ready to award
          </p>
          <p className="font-display text-label" style={{ color: C.sub }}>
            Ask {fmtCompact(totalAsk)}
            {budgetTotal > 0 && ` · ${fmtCompact(leftInRound)} left in round`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <FilterPill
            label="Programme"
            plural="programmes"
            value={programmeId}
            options={programmeOptions}
            onChange={(v) => {
              setProgrammeId(v)
              setPage(1)
            }}
          />
          <FilterPill
            label="Theme"
            plural="themes"
            value={tag}
            options={tagOptions}
            onChange={(v) => {
              setTag(v)
              setPage(1)
            }}
          />
          <FilterPill
            label="AI score"
            plural="scores"
            value={scoreBand}
            options={SCORE_BANDS.map((b) => ({ value: b.value, label: b.label }))}
            onChange={(v) => {
              setScoreBand(v)
              setPage(1)
            }}
          />
        </div>

        <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
          <DataTable
            columns={CANDIDATE_COLUMNS}
            rows={pageRows}
            rowKey={(c) => c.id}
            // A row IS a grant to set up: clicking it opens the flow for that one.
            onRowClick={(c) => setWizardFor([c])}
            selection={{
              isSelected: (c) => selected.has(c.id),
              toggle: (c) => toggleOne(c.id),
              allSelected: pageRows.length > 0 && pageRows.every((c) => selected.has(c.id)),
              someSelected: pageRows.some((c) => selected.has(c.id)),
              toggleAll: () =>
                setSelected((prev) =>
                  pageRows.every((c) => prev.has(c.id))
                    ? new Set()
                    : new Set(pageRows.map((c) => c.id)),
                ),
            }}
            empty={
              <div className="p-4">
                <EmptyState>
                  <p className="font-display text-body font-medium" style={{ color: C.sub }}>
                    {candidates.items.length === 0
                      ? 'Nothing is ready to award'
                      : 'Nothing matches these filters'}
                  </p>
                  {candidates.items.length === 0 && (
                    <p
                      className="mx-auto mt-1 max-w-md font-display text-label leading-relaxed"
                      style={{ color: C.faint }}
                    >
                      An application appears here once a majority of trustees have voted in favour
                      of it. Nothing in this round has cleared that bar yet.
                    </p>
                  )}
                </EmptyState>
              </div>
            }
          />
        </div>

        {selected.size > 0 && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-chip p-2"
            style={{ backgroundColor: C.bar }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="flex h-8 shrink-0 items-center gap-1 rounded-chip bg-white/10 pl-1.5 pr-2 font-display text-body font-medium text-white"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} color="#fff" />
                Clear
              </button>
              <span className="font-display text-label font-medium" style={{ color: C.mint }}>
                {selected.size} selected · {fmtMoney(combinedAsk)} combined ask
              </span>
            </div>
            <button
              type="button"
              onClick={() => setWizardFor(selectedRows)}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-chip bg-white px-3 font-display text-body font-medium"
              style={{ color: C.ink }}
            >
              Set up {selected.size === 1 ? 'award' : `${selected.size} awards`}
              <HugeiconsIcon icon={ArrowRight02Icon} size={16} color={C.ink} />
            </button>
          </div>
        )}

        {rows.length > 0 && (
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            shown={pageRows.length}
            total={rows.length}
            noun="applications"
            onChange={setPage}
          />
        )}
      </div>

      {/* ── Already awarded, this round ── */}
      {/* The whole card is conditional, unlike the pills inside it: a round with no
          grants yet has nothing to say here, and an empty "Grants awarded" table is a
          statement about the round rather than about a filter. */}
      {awarded.items.length > 0 && (
        <div
          className="flex flex-col gap-4 rounded-card border bg-white p-4"
          style={{ borderColor: C.line }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="font-display text-title font-medium" style={{ color: C.ink }}>
              Grants awarded
            </p>
            <p className="font-display text-label" style={{ color: C.sub }}>
              {fmtMoney(awardedTotalShown)} committed across {awardedRows.length} grant
              {awardedRows.length === 1 ? '' : 's'} in this round
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <FilterPill
              label="Programme"
              plural="programmes"
              value={awardedProgramme}
              options={awardedProgrammeOptions}
              onChange={setAwardedProgramme}
            />
          </div>

          <div className="overflow-hidden rounded-control border" style={{ borderColor: C.line }}>
            <DataTable
              columns={AWARDED_COLUMNS}
              rows={awardedRows}
              rowKey={(a) => a.awardId}
              onRowClick={(a) =>
                navigate({ to: '/awards/$awardId', params: { awardId: a.awardId } })
              }
            />
          </div>

          <Link
            to="/awards"
            search={{ roundId, programmeId: undefined, tag: undefined, q: undefined }}
            className="self-start font-display text-label font-medium hover:underline"
            style={{ color: C.brand }}
          >
            See every grant in Awards →
          </Link>
        </div>
      )}

      {wizardFor && wizardFor.length > 0 && (
        <AwardWizard
          candidates={wizardFor}
          letterSettings={letterSettings}
          onClose={() => setWizardFor(null)}
          onDone={finish}
        />
      )}
    </div>
  )
}
