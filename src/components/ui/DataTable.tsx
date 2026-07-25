import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUp01Icon, ArrowDown01Icon, ArrowUpDownIcon, Tick02Icon } from '@hugeicons/core-free-icons'

// The one table style for the whole app — the Figma applications-list table:
// a wash header row (Inter Display 14px medium), 64px hover rows, optional
// sortable headers with an arrow affordance, an optional leading checkbox column,
// and clickable rows. Each screen supplies typed column definitions with custom
// cell renderers; the chrome stays identical everywhere.

const C = {
  ink: '#141C24',
  sub: '#637083',
  faint: '#97A1AF',
  line: '#E4E7EC',
  wash: '#F2F4F7',
  brand: '#1F7A5C',
}

/** #rrggbb → rgba() at alpha. */
function alpha(hex: string, a: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** The app's status pill — a coloured dot + label on a 10%-tint background. Every
 *  table maps its own status vocabulary to a `{ label, color }` and renders this. */
export function StatusPill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-[20px] px-2"
      style={{ backgroundColor: alpha(color, 0.1) }}
    >
      <span className="size-[3px] rounded-full" style={{ backgroundColor: color }} />
      <span className="font-display text-[12px] font-medium" style={{ color }}>
        {label}
      </span>
    </span>
  )
}

export type SortDir = 'asc' | 'desc'
export type TableSort = { by: string; dir: SortDir }

export type TableColumn<T> = {
  /** Stable id; also the sort key when `sortable`. */
  id: string
  header: ReactNode
  cell: (row: T) => ReactNode
  /** Tailwind width class, e.g. 'w-[140px]'. */
  width?: string
  align?: 'left' | 'right'
  sortable?: boolean
  /** Extra classes for the body cell (e.g. 'tabular-nums'). */
  cellClassName?: string
}

export type TableSelection<T> = {
  isSelected: (row: T) => boolean
  toggle: (row: T) => void
  allSelected: boolean
  toggleAll: () => void
}

function CheckBox({ checked, onToggle, label }: { checked: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={checked}
      aria-label={label}
      className="flex size-5 items-center justify-center rounded-[6px] border transition-colors"
      style={{ borderColor: checked ? C.brand : C.line, backgroundColor: checked ? C.brand : '#fff' }}
    >
      {checked && <HugeiconsIcon icon={Tick02Icon} size={12} color="#fff" />}
    </button>
  )
}

function HeaderCell<T>({ col, sort, onSort }: { col: TableColumn<T>; sort?: TableSort; onSort?: (id: string) => void }) {
  const alignCls = col.align === 'right' ? 'text-right' : 'text-left'
  const base = `px-3 ${alignCls} ${col.width ?? ''}`
  if (!col.sortable || !onSort) {
    return (
      <th className={`${base} font-display text-[14px] font-medium`} style={{ color: C.ink }}>
        {col.header}
      </th>
    )
  }
  const active = sort?.by === col.id
  return (
    <th className={base}>
      <button
        type="button"
        onClick={() => onSort(col.id)}
        className={`group inline-flex items-center gap-1 font-display text-[14px] font-medium ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
        style={{ color: C.ink }}
      >
        {col.header}
        {active ? (
          <HugeiconsIcon icon={sort!.dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon} size={14} color={C.sub} />
        ) : (
          <span className="opacity-0 transition-opacity group-hover:opacity-100">
            <HugeiconsIcon icon={ArrowUpDownIcon} size={14} color={C.faint} />
          </span>
        )}
      </button>
    </th>
  )
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sort,
  onSort,
  selection,
  empty,
  rowClassName,
}: {
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  sort?: TableSort
  onSort?: (id: string) => void
  selection?: TableSelection<T>
  /** Shown in place of the table body when there are no rows. */
  empty?: ReactNode
  /** Per-row extra classes, e.g. dimming a revoked row. */
  rowClassName?: (row: T) => string
}) {
  if (rows.length === 0 && empty !== undefined) {
    return <>{empty}</>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="h-10" style={{ backgroundColor: C.wash }}>
            {selection && (
              <th className="w-11 px-3">
                <CheckBox checked={selection.allSelected} onToggle={selection.toggleAll} label="Select all" />
              </th>
            )}
            {columns.map((col) => (
              <HeaderCell key={col.id} col={col} sort={sort} onSort={onSort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`h-16 transition-colors hover:bg-[#F9FAFB] ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`}
            >
              {selection && (
                <td className="w-11 px-3 align-middle" onClick={(e) => e.stopPropagation()}>
                  <CheckBox checked={selection.isSelected(row)} onToggle={() => selection.toggle(row)} label="Select row" />
                </td>
              )}
              {columns.map((col) => (
                <td
                  key={col.id}
                  className={`px-3 align-middle ${col.width ?? ''} ${col.align === 'right' ? 'text-right' : ''} ${col.cellClassName ?? ''}`}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
