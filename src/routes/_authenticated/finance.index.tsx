import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Coins01Icon, Alert02Icon, Calendar03Icon, BankIcon } from '@hugeicons/core-free-icons'
import { BarMeter } from '../../components/BarMeter'
import { listFinanceGrants, type BankStatus, type FinanceStatus } from '../../server/fns/finance'
import {
  DataTable,
  EmptyState,
  ExportButton,
  KPI_TINTS,
  MiniKpi,
  StatusPill,
  Tabs,
  type TableColumn,
} from '../../components/ui'
import { fmtCompact, fmtDate, fmtMoney } from '../../lib/format'

// Derived from the server fn rather than the route loader: `Route.useLoaderData` is
// circular here (the route's component uses these types), which resolves to `any`.
type FinanceData = Awaited<ReturnType<typeof listFinanceGrants>>
type FinanceRow = FinanceData['items'][number]
type Totals = FinanceData['totals']

export const Route = createFileRoute('/_authenticated/finance/')({
  loader: async () => listFinanceGrants(),
  component: FinancePage,
})

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Headline figures: £1.9m / £148k / £950. */

/** "in 4 days" / "12 days ago" — the thing a finance officer actually reads off a due date. */
function relativeDays(iso: string | null): { text: string; overdue: boolean } | null {
  if (!iso) return null
  const today = new Date().toISOString().slice(0, 10)
  const days = Math.round(
    (new Date(`${iso}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  )
  if (days === 0) return { text: 'today', overdue: false }
  if (days < 0) return { text: `${-days} day${days === -1 ? '' : 's'} ago`, overdue: true }
  return { text: `in ${days} day${days === 1 ? '' : 's'}`, overdue: false }
}

const STATUS_LABELS: Record<FinanceStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  scheduled: 'Scheduled',
  unscheduled: 'No schedule',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

const STATUS_HEX: Record<FinanceStatus, string> = {
  overdue: '#FF4242',
  due_soon: '#9B6916',
  scheduled: '#637083',
  unscheduled: '#B54708',
  paid: '#31A650',
  cancelled: '#97A1AF',
}

const BANK_ISSUE_LABELS: Partial<Record<BankStatus, string>> = {
  missing: 'No details',
  invalid: 'Check failed',
  unchecked: 'Unverified',
}

const txtSub = 'font-display text-[14px] text-[#637083]'

// ─── Columns ─────────────────────────────────────────────────────────────────

const ORGANISATION: TableColumn<FinanceRow> = {
  id: 'organisation',
  header: 'Organisation',
  cell: (g) => (
    <Link
      to="/finance/$awardId"
      params={{ awardId: g.awardId }}
      onClick={(e) => e.stopPropagation()}
      className="font-display text-[14px] font-medium text-[#141C24] hover:underline"
    >
      {g.organisationName}
    </Link>
  ),
}

const PROGRAMME: TableColumn<FinanceRow> = {
  id: 'programme',
  header: 'Programme',
  cell: (g) => <span className={txtSub}>{g.programmeName ?? '—'}</span>,
}

const COMMITTED: TableColumn<FinanceRow> = {
  id: 'committed',
  header: 'Committed',
  width: 'w-[120px]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <span className="whitespace-nowrap font-display text-[14px] font-medium text-[#141C24]">
      {fmtMoney(g.committed)}
    </span>
  ),
}

const PAID: TableColumn<FinanceRow> = {
  id: 'paid',
  header: 'Paid',
  width: 'w-[130px]',
  cellClassName: 'tabular-nums',
  cell: (g) => (
    <div className="whitespace-nowrap">
      <span className={txtSub}>{g.paidToDate > 0 ? fmtMoney(g.paidToDate) : '—'}</span>
      {g.instalmentCount > 0 && (
        <span className="ml-1 font-display text-[12px] text-[#97A1AF]">
          {g.paidCount}/{g.instalmentCount}
        </span>
      )}
    </div>
  ),
}

const BANK: TableColumn<FinanceRow> = {
  id: 'bank',
  header: 'Bank',
  width: 'w-[120px]',
  cell: (g) => {
    const issue = BANK_ISSUE_LABELS[g.bank.status]
    if (!issue) {
      return (
        <span className="whitespace-nowrap font-display text-[14px] tabular-nums text-[#637083]">
          ••••{g.bank.last4 ?? '—'}
        </span>
      )
    }
    return (
      <span
        className="whitespace-nowrap font-display text-[13px] font-medium"
        style={{ color: g.bank.status === 'missing' ? '#B54708' : '#FF4242' }}
      >
        {issue}
      </span>
    )
  },
}

const STATUS: TableColumn<FinanceRow> = {
  id: 'status',
  header: 'Status',
  width: 'w-[130px]',
  cell: (g) => <StatusPill label={STATUS_LABELS[g.status]} color={STATUS_HEX[g.status]} />,
}

const TO_PAY_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  PROGRAMME,
  COMMITTED,
  PAID,
  {
    id: 'next',
    header: 'Next payment',
    width: 'w-[170px]',
    cellClassName: 'tabular-nums',
    cell: (g) => {
      if (!g.nextPayment) {
        return <span className="font-display text-[14px] text-[#97A1AF]">No schedule</span>
      }
      const rel = relativeDays(g.nextPayment.dueDate)
      return (
        <div className="whitespace-nowrap">
          <div className="font-display text-[14px] font-medium text-[#141C24]">
            {fmtMoney(g.nextPayment.amount)}
          </div>
          <div
            className="font-display text-[12px]"
            style={{ color: rel?.overdue ? '#FF4242' : '#97A1AF' }}
          >
            {g.nextPayment.dueDate
              ? `${fmtDate(g.nextPayment.dueDate)} · ${rel!.text}`
              : 'Date TBC'}
          </div>
        </div>
      )
    },
  },
  BANK,
  STATUS,
]

const PAID_COLUMNS: TableColumn<FinanceRow>[] = [
  ORGANISATION,
  PROGRAMME,
  COMMITTED,
  PAID,
  {
    id: 'lastPaid',
    header: 'Last payment',
    width: 'w-[150px]',
    cell: (g) => <span className={`whitespace-nowrap ${txtSub}`}>{fmtDate(g.lastPaidDate)}</span>,
  },
  BANK,
  STATUS,
]

// ─── Page ────────────────────────────────────────────────────────────────────

type Tab = 'to_pay' | 'paid'

function FinancePage() {
  const { items, totals } = Route.useLoaderData()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('to_pay')

  // "To pay" is anything still owing money; everything else — settled, and cancelled
  // grants whose payments are history — sits under "Paid", so every grant appears
  // under exactly one tab.
  const toPay = items.filter((g) => g.status !== 'paid' && g.status !== 'cancelled')
  const settled = items.filter((g) => g.status === 'paid' || g.status === 'cancelled')
  const rows = tab === 'to_pay' ? toPay : settled

  const paidPct =
    totals.committed > 0 ? Math.round((totals.paidToDate / totals.committed) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[21px] font-semibold text-gray-900">Finance</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Grant payments · {totals.grantCount} live commitment{totals.grantCount === 1 ? '' : 's'}
          </p>
        </div>
        <ExportButton onClick={() => exportCsv(rows, tab)} disabled={rows.length === 0} />
      </div>

      <StatCards totals={totals} paidPct={paidPct} />

      {(totals.bankIssueCount > 0 || totals.unscheduledCount > 0) && <Attention totals={totals} />}

      <Tabs
        ariaLabel="Payment status"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'to_pay', label: 'To pay', count: toPay.length },
          { id: 'paid', label: 'Paid', count: settled.length },
        ]}
      />

      {rows.length === 0 ? (
        <EmptyState>
          <p className="text-sm text-gray-500">
            {tab === 'to_pay'
              ? 'Nothing outstanding — every grant is paid up.'
              : 'No payments made yet.'}
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Grants appear here as soon as an award is generated, with the instalment schedule set on
            the award.
          </p>
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-[#E4E7EC] bg-white">
          <DataTable
            columns={tab === 'to_pay' ? TO_PAY_COLUMNS : PAID_COLUMNS}
            rows={rows}
            rowKey={(g) => g.awardId}
            onRowClick={(g) =>
              navigate({ to: '/finance/$awardId', params: { awardId: g.awardId } })
            }
          />
        </div>
      )}
    </div>
  )
}

function StatCards({ totals, paidPct }: { totals: Totals; paidPct: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MiniKpi
        tint={KPI_TINTS.pink}
        icon={Alert02Icon}
        label="Overdue"
        value={fmtCompact(totals.overdueAmount)}
        valueColor={totals.overdueAmount > 0 ? '#FF4242' : undefined}
        sub={
          totals.overdueCount === 0
            ? 'nothing past its due date'
            : `${totals.overdueCount} payment${totals.overdueCount === 1 ? '' : 's'} · ${totals.overdueGrants} grant${totals.overdueGrants === 1 ? '' : 's'}`
        }
      />
      <MiniKpi
        tint={KPI_TINTS.amber}
        icon={Calendar03Icon}
        label="Due in 30 days"
        value={fmtCompact(totals.dueSoonAmount)}
        sub={`${totals.dueSoonCount} payment${totals.dueSoonCount === 1 ? '' : 's'} scheduled`}
      />
      <MiniKpi
        tint={KPI_TINTS.violet}
        icon={Coins01Icon}
        label="Outstanding"
        value={fmtCompact(totals.outstanding)}
        sub={`of ${fmtCompact(totals.committed)} committed`}
      />
      <MiniKpi
        tint={KPI_TINTS.green}
        icon={BankIcon}
        label="Paid to date"
        value={fmtCompact(totals.paidToDate)}
        sub={`${paidPct}% of commitments · ${totals.paidCount} payment${totals.paidCount === 1 ? '' : 's'}`}
      >
        <BarMeter
          className="mt-3"
          progress={paidPct / 100}
          color={KPI_TINTS.green.accent}
          height={16}
        />
      </MiniKpi>
    </div>
  )
}

/** The two things that stop a payment run before it starts. */
function Attention({ totals }: { totals: Totals }) {
  const parts: string[] = []
  if (totals.bankIssueCount > 0) {
    parts.push(
      `${totals.bankIssueCount} grant${totals.bankIssueCount === 1 ? ' has' : 's have'} missing or invalid bank details`,
    )
  }
  if (totals.unscheduledCount > 0) {
    parts.push(
      `${totals.unscheduledCount} grant${totals.unscheduledCount === 1 ? ' has' : 's have'} no payment schedule`,
    )
  }
  return (
    <div className="rounded-[12px] border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm text-amber-800">
        <span className="font-medium">Needs attention · </span>
        {parts.join(' · ')}. These cannot be paid until fixed.
      </p>
    </div>
  )
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * A reconciliation export of the current tab — the figures on screen, as a
 * spreadsheet. Deliberately NOT a payment file: it carries only the masked account
 * (last four), so it can be shared without handing over payable bank details.
 */
function exportCsv(rows: FinanceRow[], tab: Tab) {
  const header = [
    'Organisation',
    'Programme',
    'Round',
    'Committed',
    'Paid to date',
    'Outstanding',
    'Instalments paid',
    'Next payment',
    'Next payment due',
    'Last paid',
    'Status',
    'Bank',
    'Account (last 4)',
  ]
  const body = rows.map((g) => [
    g.organisationName,
    g.programmeName ?? '',
    g.roundName ?? '',
    g.committed,
    g.paidToDate,
    g.outstanding,
    `${g.paidCount}/${g.instalmentCount}`,
    g.nextPayment?.amount ?? '',
    g.nextPayment?.dueDate ?? '',
    g.lastPaidDate ?? '',
    STATUS_LABELS[g.status],
    g.bank.status,
    g.bank.last4 ?? '',
  ])
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `custodian-finance-${tab === 'to_pay' ? 'to-pay' : 'paid'}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
