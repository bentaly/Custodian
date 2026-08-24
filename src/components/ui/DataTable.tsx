import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowUp01Icon, ArrowDown01Icon, ArrowUpDownIcon } from '@hugeicons/core-free-icons'
import { C } from './tokens'
import { Checkbox } from './Checkbox'

// The one table style for the whole app — the Figma applications-list table:
// a wash header row (Inter Display 14px medium), 64px hover rows, optional
// sortable headers with an arrow affordance, an optional leading checkbox column,
// and clickable rows. Each screen supplies typed column definitions with custom
// cell renderers; the chrome stays identical everywhere.

/** Any CSS colour → the same colour at alpha. `color-mix`, not hex maths, because the
 *  colours handed in are `var(--color-*)` tokens. */
function alpha(color: string, a: number) {
  return `color-mix(in srgb, ${color} ${a * 100}%, transparent)`
}

/** The app's status pill — a coloured dot + label on a 10%-tint background. Every
 *  table maps its own status vocabulary to a `{ label, colour }` and renders this. */
export function StatusPill({ label, colour }: { label: string; colour: string }) {
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill px-2"
      style={{ backgroundColor: alpha(colour, 0.1) }}
    >
      <span className="size-[3px] rounded-full" style={{ backgroundColor: colour }} />
      <span className="font-display text-label font-medium" style={{ color: colour }}>
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
  /**
   * Tailwind width class, and under `sm:table-fixed` a real cap rather than a hint —
   * the column is this wide and its cells truncate. Prefix it with `sm:` (e.g.
   * `'sm:w-[12%]'`): these widths are tuned for the full desktop column set, and on a
   * phone the two or three columns that survive `hideBelow` should share the row
   * instead — pinned widths there leave the name column a sliver.
   *
   * A PERCENTAGE, not pixels. Pixel widths cannot over-subscribe safely: eight columns
   * of 130–160px read as modest until the sidebar and page padding leave a table 1100px
   * wide, at which point they consume everything and the identity column — the one
   * declaring no width, living on what is left — collapses to a few characters. It did.
   * Percentages of the table's own width can't do that, and they widen with the screen
   * rather than pooling all the extra space in one column.
   *
   * LEAVE IT UNSET on the one column that should absorb the remainder — the identity
   * column every table leads with. Width every other column, and keep their total to
   * roughly 75–85%, which is the identity column's share.
   *
   * A cell in a capped column must truncate its own content (`TruncatedText`, or
   * `truncate`): fixed layout stops the COLUMN growing, not the text inside it.
   */
  width?: string
  align?: 'left' | 'right'
  sortable?: boolean
  /** Extra classes for the body cell (e.g. 'tabular-nums'). */
  cellClassName?: string
  /**
   * Keep clicks inside this cell from reaching `onRowClick`. For a cell whose content
   * is itself something to interact with — a tooltip you open to read, an inline
   * control — where opening it must not also open the row.
   */
  stopRowClick?: boolean
  /**
   * Drop this column below the given breakpoint. Every row here is a link into a
   * detail screen that carries the full record, so on a phone the table earns its
   * keep as a *list* — identity plus the one or two figures you scan for — rather
   * than as a grid you scroll sideways through. Leave unset for the columns that
   * make a row identifiable (name, amount, status).
   */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
}

// Tailwind needs whole class names, so the breakpoints are spelled out.
const HIDE_BELOW = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const

export type TableSelection<T> = {
  isSelected: (row: T) => boolean
  toggle: (row: T) => void
  allSelected: boolean
  /** Some-but-not-all: the header box shows a dash and announces as `mixed`. Without it
   *  a partial selection reads as "nothing selected". */
  someSelected?: boolean
  toggleAll: () => void
}

/** Row/header checkbox. The visual and the semantics both live in `Checkbox`; this only
 *  stops the click reaching the row's own `onRowClick`.
 *
 *  The `flex` wrapper is load-bearing, not spacing. `Checkbox` is an `inline-flex`
 *  `<label>`, so on its own it sits in a line box and aligns its bottom edge to the
 *  TEXT BASELINE — leaving room for a descender under it that the header's text cells
 *  don't have. The box therefore rode a couple of pixels above "Organisation". Making
 *  the cell's content a flex container takes the checkbox out of inline flow, so the
 *  cell's `vertical-align: middle` centres the box itself. */
function CellCheckbox({
  checked,
  indeterminate,
  onToggle,
  label,
}: {
  checked: boolean
  indeterminate?: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <div className="flex items-center">
      <Checkbox
        checked={checked}
        indeterminate={indeterminate}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        aria-label={label}
      />
    </div>
  )
}

function HeaderCell<T>({
  col,
  sort,
  onSort,
}: {
  col: TableColumn<T>
  sort?: TableSort
  onSort?: (id: string) => void
}) {
  const alignCls = col.align === 'right' ? 'text-right' : 'text-left'
  const base = `px-3 ${alignCls} ${col.width ?? ''} ${col.hideBelow ? HIDE_BELOW[col.hideBelow] : ''}`
  if (!col.sortable || !onSort) {
    return (
      <th className={`${base} font-display text-body font-medium`} style={{ color: C.ink }}>
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
        className={`group inline-flex items-center gap-1 font-display text-body font-medium ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
        style={{ color: C.ink }}
      >
        {col.header}
        {active ? (
          <HugeiconsIcon
            icon={sort!.dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon}
            size={14}
            color={C.sub}
          />
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
      {/* `table-fixed` from `sm` up is what makes `col.width` a CAP rather than a
          suggestion. Under the browser's default auto layout a column grows to fit its
          widest cell whatever width was declared, so one grantee with seven themes
          pushed the last three columns off the right-hand edge and a programme called
          "Long-term local partnerships" stacked three lines deep — the widths were
          being written and quietly ignored. Fixed layout reads the header row, honours
          the declared widths, and hands what is left to the columns that declared none;
          cells then truncate instead of shoving their neighbours.

          Below `sm` it stays auto: the widths are all `sm:`-prefixed for the desktop
          column set, and fixed layout with none of them declared would split a phone's
          screen equally between the two or three columns that survive `hideBelow`,
          leaving the name a sliver. */}
      <table className="w-full table-auto border-collapse sm:table-fixed">
        <thead>
          <tr className="h-10" style={{ backgroundColor: C.wash }}>
            {selection && (
              <th className="w-11 px-3">
                <CellCheckbox
                  checked={selection.allSelected}
                  indeterminate={!selection.allSelected && (selection.someSelected ?? false)}
                  onToggle={selection.toggleAll}
                  label="Select all rows"
                />
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
              className={`h-16 transition-colors hover:bg-grey-50 ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(row) ?? ''}`}
            >
              {selection && (
                <td className="w-11 px-3 align-middle" onClick={(e) => e.stopPropagation()}>
                  <CellCheckbox
                    checked={selection.isSelected(row)}
                    onToggle={() => selection.toggle(row)}
                    label="Select row"
                  />
                </td>
              )}
              {columns.map((col) => (
                <td
                  key={col.id}
                  onClick={col.stopRowClick ? (e) => e.stopPropagation() : undefined}
                  className={`px-3 align-middle ${col.width ?? ''} ${col.align === 'right' ? 'text-right' : ''} ${col.hideBelow ? HIDE_BELOW[col.hideBelow] : ''} ${col.cellClassName ?? ''}`}
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
