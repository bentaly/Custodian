import type { Meta, StoryObj } from '@storybook/react-vite'
import { BankIcon, Calendar03Icon, Coins01Icon, Target01Icon } from '@hugeicons/core-free-icons'
import { DataTable, StatusPill, type TableColumn } from './DataTable'
import { MiniKpi, KPI_TINTS } from './MiniKpi'
import { Badge } from './Badge'
import { EmptyState } from './Card'
import { Pagination } from './Pagination'
import { C } from './tokens'

// What a list screen is made of, above the filters: the stat row, the table, the
// pagination line — and the two ways a table can be empty.

const meta = {
  title: 'Data display/Table & KPIs',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

type Row = {
  id: string
  organisation: string
  programme: string
  amount: string
  status: 'active' | 'completed' | 'cancelled'
}

const ROWS: Row[] = [
  {
    id: '1',
    organisation: 'Rivermead Youth Trust',
    programme: 'Youth work',
    amount: '£45,000',
    status: 'active',
  },
  {
    id: '2',
    organisation: 'Northside Housing Co-op',
    programme: 'Housing',
    amount: '£120,000',
    status: 'completed',
  },
  {
    id: '3',
    organisation: 'Coastal Food Partnership',
    programme: 'Food security',
    amount: '£18,500',
    status: 'cancelled',
  },
]

const STATUS_HEX = { active: C.success, completed: C.sub, cancelled: C.danger }
const STATUS_LABEL = { active: 'Active', completed: 'Done', cancelled: 'Cancelled' }

const COLUMNS: TableColumn<Row>[] = [
  {
    id: 'organisation',
    header: 'Organisation',
    sortable: true,
    cell: (r) => (
      <span className="font-display text-body font-medium text-grey-900">{r.organisation}</span>
    ),
  },
  {
    id: 'programme',
    header: 'Programme',
    cell: (r) => <span className="font-display text-body text-grey-500">{r.programme}</span>,
  },
  {
    id: 'amount',
    header: 'Amount',
    width: 'sm:w-[130px]',
    sortable: true,
    cell: (r) => (
      <span className="font-display text-body font-medium tabular-nums text-grey-900">
        {r.amount}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 'sm:w-[120px]',
    cell: (r) => <StatusPill label={STATUS_LABEL[r.status]} colour={STATUS_HEX[r.status]} />,
  },
]

export const Table: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-card border border-grey-200 bg-white">
        <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />
      </div>
      <Pagination page={1} pageCount={4} shown={3} total={87} noun="awards" onChange={() => {}} />
    </div>
  ),
}

/** Selection turns the first column into checkboxes; the toolbar is the screen's own. */
export const TableWithSelection: Story = {
  render: () => (
    <div className="overflow-hidden rounded-card border border-grey-200 bg-white">
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        sort={{ by: 'amount', dir: 'desc' }}
        onSort={() => {}}
        selection={{
          isSelected: (r) => r.id === '2',
          toggle: () => {},
          allSelected: false,
          toggleAll: () => {},
        }}
      />
    </div>
  ),
}

export const Empty: Story = {
  render: () => (
    <EmptyState>
      <p className="text-body text-grey-500">No awards match these filters.</p>
      <p className="mt-1 text-label text-grey-400">
        Awards appear here as soon as one is generated after the trustee vote.
      </p>
    </EmptyState>
  ),
}

/** The stat row above a list. Four tints, in the order they read across. */
export const KpiRow: Story = {
  render: () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MiniKpi
        tint={KPI_TINTS.violet}
        icon={Coins01Icon}
        label="Total awarded"
        value="£1.24m"
        sub="32 awards"
      />
      <MiniKpi
        tint={KPI_TINTS.green}
        icon={BankIcon}
        label="Paid to date"
        value="£880,000"
        sub="£360,000 outstanding"
      />
      <MiniKpi
        tint={KPI_TINTS.amber}
        icon={Calendar03Icon}
        label="Multi-year"
        value="9"
        sub="awards running over 1 year"
      />
      <MiniKpi
        tint={KPI_TINTS.pink}
        icon={Target01Icon}
        label="By programme"
        value="Youth work"
        sub="£420k · largest share"
      />
    </div>
  ),
}

/** The dashboard/Insights headline size of the same card. */
export const KpiLarge: Story = {
  render: () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <MiniKpi
        size="lg"
        tint={KPI_TINTS.violet}
        icon={Coins01Icon}
        label="Total awarded"
        value="£1.24m"
        sub="across 32 grants"
      />
      <MiniKpi
        size="lg"
        tint={KPI_TINTS.green}
        icon={BankIcon}
        label="Paid to date"
        value="£880,000"
        sub="71% of commitments"
      />
    </div>
  ),
}

export const Pills: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StatusPill label="In review" colour={C.amber} />
      <StatusPill label="Shortlisted" colour={C.success} />
      <StatusPill label="Awarded" colour={C.brand} />
      <StatusPill label="Declined" colour={C.danger} />
      <Badge className="bg-grey-100 text-grey-600">Closed</Badge>
      <Badge className="bg-success/10 text-success">In open round</Badge>
      {/* The small pill, for a line item inside a card rather than the card's own status. */}
      <Badge size="sm" className="bg-success/10 text-success">
        Paid
      </Badge>
      <Badge size="sm" className="bg-warning/10 text-warning">
        Due next
      </Badge>
      <Badge size="sm" className="bg-grey-100 text-grey-400">
        Upcoming
      </Badge>
    </div>
  ),
}
