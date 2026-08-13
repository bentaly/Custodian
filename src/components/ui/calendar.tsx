import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'

// The month grid the app's two date controls share (Figma 434:14130) — `DateField`
// draws one day on it, `DateRangePicker` draws two and everything between. It lives
// apart from both because a calendar rendered twice is a calendar that will disagree
// with itself: the day cell is 32×24 with a 2px gutter, and the grid is always six
// weeks so paging months never changes the popover's height.
//
// Dates are plain `yyyy-mm-dd` strings and every calculation runs in local time: a day
// the user picked in the UI must not shift because of a UTC round-trip.

// ─── Local-date helpers ──────────────────────────────────────────────────────────

export function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate())
}
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
/** Sunday-first, matching the design's S M T W T F S header. */
export function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay())
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** British short form — `17 Feb 2022`. */
export function fmtDay(s: string): string {
  return parseIso(s).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ─── The grid ────────────────────────────────────────────────────────────────────

/**
 * How a day is painted. `selected` is an end of the selection — a solid brand block, so
 * its number is WHITE; `range` is a day between two ends — Brand/Secondary behind brand
 * text. Both are stated here rather than at each call site precisely because getting the
 * foreground wrong on the solid block hides the number altogether.
 */
export type DayTone = 'none' | 'range' | 'selected'

const DAY_CELL =
  'flex h-6 w-8 items-center justify-center rounded-chip font-display text-label font-medium focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-hidden'

export function CalendarPanel({
  month,
  onMonthChange,
  toneFor,
  isDisabled,
  onPick,
  autoFocus = false,
}: {
  /** Any day in the month on show; only its year and month are read. */
  month: Date
  onMonthChange: (next: Date) => void
  toneFor: (day: string) => DayTone
  /** Days outside the allowed window — dimmed and unclickable. */
  isDisabled?: (day: string) => boolean
  onPick: (day: Date) => void
  /** Put the keyboard on the grid as soon as it appears — right for a popover the
   *  user just opened, wrong for a calendar sitting inline on a page. */
  autoFocus?: boolean
}) {
  // Six weeks from the Sunday on/before the 1st — a fixed grid, so the popover doesn't
  // change height as the user pages through months.
  const gridStart = startOfWeek(startOfMonth(month))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  // A roving tabindex: ONE day is tabbable and the arrows move which, so the grid costs
  // a keyboard user a single Tab stop rather than forty-two. Replacing `<input
  // type="date">` with a custom widget is only allowed if this comes with it — the
  // native control could be driven entirely from the keyboard.
  const gridRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState(() => {
    const selected = days.find((d) => toneFor(iso(d)) === 'selected')
    return iso(selected ?? startOfMonth(month))
  })
  const takeFocus = useRef(autoFocus)

  // Paging months from the header buttons carries the cursor along, so the next arrow
  // key continues from what is on screen rather than from a day nobody can see.
  useEffect(() => {
    const c = parseIso(cursor)
    if (c.getMonth() !== month.getMonth() || c.getFullYear() !== month.getFullYear()) {
      setCursor(iso(startOfMonth(month)))
    }
  }, [month]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!takeFocus.current) return
    takeFocus.current = false
    gridRef.current?.querySelector<HTMLButtonElement>('[data-day][tabindex="0"]')?.focus()
  })

  /** Move the cursor by `n` days, following the grid into the next month if needed. */
  function move(n: number) {
    const next = addDays(parseIso(cursor), n)
    setCursor(iso(next))
    takeFocus.current = true
    if (next.getMonth() !== month.getMonth() || next.getFullYear() !== month.getFullYear()) {
      onMonthChange(startOfMonth(next))
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (by !== undefined) {
      e.preventDefault()
      move(by)
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const next = addMonths(parseIso(cursor), e.key === 'PageUp' ? -1 : 1)
      setCursor(iso(next))
      takeFocus.current = true
      onMonthChange(startOfMonth(next))
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(-parseIso(cursor).getDay())
    } else if (e.key === 'End') {
      e.preventDefault()
      move(6 - parseIso(cursor).getDay())
    }
  }

  return (
    <>
      <div className="flex w-full items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onMonthChange(addMonths(startOfMonth(month), -1))}
          className="flex size-8 items-center justify-center rounded-chip border bg-white hover:bg-grey-100"
          style={{ borderColor: C.line }}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} color={C.ink} />
        </button>
        <span className="font-display text-label font-medium" style={{ color: C.ink }}>
          {MONTHS[month.getMonth()]} {month.getFullYear()}
        </span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onMonthChange(addMonths(startOfMonth(month), 1))}
          className="flex size-8 items-center justify-center rounded-chip border bg-white hover:bg-grey-100"
          style={{ borderColor: C.line }}
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} color={C.ink} />
        </button>
      </div>

      {/* `role="grid"` rather than a real <table>: the cells are a flex layout, and the
          keydown listener sits on the container because the arrows move focus BETWEEN
          the day buttons, which are the interactive elements. */}
      <div ref={gridRef} role="grid" onKeyDown={onKeyDown} className="flex flex-col gap-0.5">
        <div role="row" className="flex gap-0.5">
          {WEEKDAYS.map((d, i) => (
            <span key={i} role="columnheader" className={DAY_CELL} style={{ color: C.faint }}>
              {d}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, w) => (
          <div key={w} role="row" className="flex gap-0.5">
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const s = iso(d)
              const tone = toneFor(s)
              const off = isDisabled?.(s) ?? false
              const outside = d.getMonth() !== month.getMonth()
              return (
                <button
                  key={s}
                  data-day={s}
                  type="button"
                  disabled={off}
                  role="gridcell"
                  tabIndex={s === cursor ? 0 : -1}
                  aria-selected={tone === 'selected'}
                  aria-label={fmtDay(s)}
                  onFocus={() => setCursor(s)}
                  onClick={() => onPick(d)}
                  className={`${DAY_CELL} ${tone === 'none' && !off ? 'hover:bg-grey-100' : ''} ${off ? 'cursor-not-allowed' : ''}`}
                  style={{
                    backgroundColor:
                      tone === 'selected'
                        ? C.brand
                        : tone === 'range'
                          ? C.brandSecondary
                          : undefined,
                    // The solid brand block needs a WHITE number to be readable at all.
                    color:
                      tone === 'selected'
                        ? C.white
                        : tone === 'range'
                          ? C.brand
                          : off || outside
                            ? C.muted
                            : C.body,
                  }}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}
