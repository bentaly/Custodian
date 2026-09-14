import { Fragment, useState, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'

/**
 * A table whose aggregate rows open into their own breakdown, in the same columns.
 *
 * One pattern for every "this total is made of these" on a screen, rather than a bespoke
 * breakdown widget per row: Balance & budget opens core costs into their lines and each
 * grant line into its programmes, all through this. It is the pivot-table model a finance
 * lead already has: expand a group, read its members, collapse it again.
 *
 * - **Collapsed by default**, so the first read is the short reconciliation, not a list.
 * - **The chevron is on the row**, and the whole row toggles. A separate "view breakdown"
 *   link would be a second target for one action.
 * - **Children are the caller's rows, not a recalculation.** The component draws what it is
 *   given; keeping a parent equal to the sum of its children is the caller's rule (see
 *   `buildBalanceSummary`), and nothing here can make them disagree.
 *
 * The chrome matches `DataTable` (wash header, hairline rows) so it reads as the same
 * table family. It is not built on `DataTable` because that one's rows are links into a
 * detail screen, while these rows open in place.
 */

export type BreakdownColumn<T> = {
  id: string
  header: ReactNode
  cell: (row: T, depth: 0 | 1) => ReactNode
  /**
   * Tailwind width class. Leave unset — the normal case — and the column shrinks to its
   * content, with the name column taking what is left. Fixed percentages left a gap of
   * empty space after the last figure once the figures were left-aligned.
   */
  width?: string
  /** Drop the column below this breakpoint. */
  hideBelow?: 'sm' | 'md'
}

export type BreakdownRow<T> = {
  key: string
  data: T
  children?: { key: string; data: T }[]
}

const HIDE_BELOW = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell' } as const

/**
 * The header stays in view while a long breakdown scrolls. The wash is on the cells, not
 * the `<tr>`, because a row's background does not travel with its sticky cells.
 * `-top-4` is `<main>`'s `p-4`: a sticky `top-0` pins to the scrollport's CONTENT box, so
 * rows would show through a 16px gap above the header (same coupling as `SettingsSaveBar`).
 */
const HEAD_CELL = 'sm:sticky sm:-top-4 sm:z-10 bg-grey-100'

export function BreakdownTable<T>({
  label,
  name,
  columns,
  rows,
  footer,
}: {
  /** The first column's header. */
  label: ReactNode
  /** The first cell of a row: its name, and anything said under it. */
  name: (row: T, depth: 0 | 1) => ReactNode
  /** The figure columns. Left-aligned, like every table in the app. */
  columns: BreakdownColumn<T>[]
  rows: BreakdownRow<T>[]
  /** `<tr>`s for below the rows (a total, a reconciliation), in this table's columns. */
  footer?: ReactNode
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /**
   * A figure column's sizing and spacing. Unwidthed columns shrink to their content
   * (`w-px` + no wrapping, under auto layout); every column but the last carries extra
   * space on its right, so left-aligned figures still read as separate columns rather than
   * one run of numbers.
   */
  const figureClass = (col: BreakdownColumn<T>, i: number) =>
    `${col.width ?? 'w-px whitespace-nowrap'} ${i < columns.length - 1 ? 'pl-3 pr-10' : 'px-3'} ${col.hideBelow ? HIDE_BELOW[col.hideBelow] : ''}`

  const cells = (row: T, depth: 0 | 1) =>
    columns.map((col, i) => (
      <td key={col.id} className={`py-3 text-left align-top tabular-nums ${figureClass(col, i)}`}>
        {col.cell(row, depth)}
      </td>
    ))

  return (
    // Sticky needs no scroll container between the header and `<main>`: an `overflow-x-auto`
    // wrapper becomes one, and the header would stick inside a box that never scrolls. So the
    // wrapper only scrolls sideways on a phone, where the header does not stick.
    <div className="overflow-x-auto sm:overflow-visible">
      <table className="w-full table-auto border-collapse font-display text-body">
        <thead>
          <tr className="h-10" style={{ color: C.ink }}>
            <th scope="col" className={`${HEAD_CELL} px-3 text-left font-medium`}>
              {label}
            </th>
            {columns.map((col, i) => (
              <th
                key={col.id}
                scope="col"
                className={`${HEAD_CELL} text-left font-medium ${figureClass(col, i)}`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expandable = (row.children?.length ?? 0) > 0
            const isOpen = expandable && open.has(row.key)
            return (
              <Fragment key={row.key}>
                <tr
                  className={`border-t ${expandable ? 'cursor-pointer transition-colors hover:bg-grey-50' : ''}`}
                  style={{ borderColor: C.line, color: C.ink }}
                  onClick={expandable ? () => toggle(row.key) : undefined}
                >
                  <th scope="row" className="px-3 py-3 text-left align-top font-normal">
                    <div className="flex items-start gap-1.5">
                      {expandable ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? 'Hide breakdown' : 'Show breakdown'}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggle(row.key)
                          }}
                          className="mt-0.5 flex shrink-0 rounded-full"
                        >
                          <HugeiconsIcon
                            icon={ArrowRight01Icon}
                            size={16}
                            color={C.sub}
                            className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          />
                        </button>
                      ) : (
                        // Keeps every name on one left edge whether or not it opens.
                        <span aria-hidden className="w-4 shrink-0" />
                      )}
                      <div className="min-w-0">{name(row.data, 0)}</div>
                    </div>
                  </th>
                  {cells(row.data, 0)}
                </tr>
                {isOpen &&
                  row.children!.map((child) => (
                    <tr
                      key={`${row.key}:${child.key}`}
                      className="border-t"
                      style={{ borderColor: C.line, color: C.body, backgroundColor: C.wash }}
                    >
                      <th scope="row" className="py-2.5 pl-11 pr-3 text-left align-top font-normal">
                        {name(child.data, 1)}
                      </th>
                      {cells(child.data, 1)}
                    </tr>
                  ))}
              </Fragment>
            )
          })}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  )
}
