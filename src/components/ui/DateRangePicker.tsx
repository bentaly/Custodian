import { useEffect, useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'

// The app's date-range control (Figma 434:14112) — a filter pill that opens a
// quick-ranges list beside a two-click calendar. Shared because it appears on
// several screens (Insights, Applications, …); each caller only owns what the
// range means for its own data.
//
// Dates are plain `yyyy-mm-dd` strings, inclusive at both ends, and every
// calculation runs in local time: a range the user picked in the UI must not
// shift a day because of a UTC round-trip.

const C = {
  ink: '#141C24', // Gray/900
  body: '#344051', // Gray/700
  sub: '#637083', // Gray/500
  faint: '#97A1AF', // Gray/400
  muted: '#CED2DA', // Gray/300
  line: '#E4E7EC', // Gray/200
  brand: '#1F7A5C',
  brandWash: '#DFF3EA',
}

/** Inclusive `yyyy-mm-dd` bounds. Both absent = no restriction ("All time"). */
export type DateRange = { from?: string; to?: string }

// ─── Local-date helpers ──────────────────────────────────────────────────────────

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate())
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}
/** Sunday-first, matching the design's S M T W T F S header. */
function startOfWeek(d: Date): Date {
  return addDays(d, -d.getDay())
}

const MONTHS = [
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
function fmtDay(s: string): string {
  return parseIso(s).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** `17 Feb – 21 Feb 2022`, collapsing the repeated year. */
export function formatDateRange(range: DateRange, allLabel = 'All time'): string {
  const { from, to } = range
  if (!from && !to) return allLabel
  if (from && !to) return `From ${fmtDay(from)}`
  if (!from && to) return `Until ${fmtDay(to)}`
  const a = parseIso(from!)
  const b = parseIso(to!)
  const short = { day: 'numeric', month: 'short' } as const
  const left =
    a.getFullYear() === b.getFullYear() ? a.toLocaleDateString('en-GB', short) : fmtDay(from!)
  return `${left} – ${fmtDay(to!)}`
}

// ─── Quick ranges ────────────────────────────────────────────────────────────────

export type QuickRange = { id: string; label: string; range: (today: Date) => DateRange }

export const DEFAULT_QUICK_RANGES: QuickRange[] = [
  { id: 'week', label: 'This week', range: (t) => ({ from: iso(startOfWeek(t)), to: iso(t) }) },
  { id: '7d', label: 'Last 7 days', range: (t) => ({ from: iso(addDays(t, -6)), to: iso(t) }) },
  { id: '30d', label: 'Last 30 days', range: (t) => ({ from: iso(addDays(t, -29)), to: iso(t) }) },
  { id: '3m', label: 'Last 3 months', range: (t) => ({ from: iso(addMonths(t, -3)), to: iso(t) }) },
  { id: '6m', label: 'Last 6 months', range: (t) => ({ from: iso(addMonths(t, -6)), to: iso(t) }) },
  {
    id: 'year',
    label: 'This year',
    range: (t) => ({ from: iso(new Date(t.getFullYear(), 0, 1)), to: iso(t) }),
  },
  { id: 'all', label: 'All time', range: () => ({}) },
]

// ─── Component ───────────────────────────────────────────────────────────────────

export function DateRangePicker({
  value,
  onChange,
  allLabel = 'All time',
  align = 'right',
  quickRanges = DEFAULT_QUICK_RANGES,
}: {
  value: DateRange
  onChange: (next: DateRange) => void
  /** Trigger text when the range is unbounded. */
  allLabel?: string
  /** Which edge the popover hangs from — it is wider than the trigger. */
  align?: 'left' | 'right'
  quickRanges?: QuickRange[]
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange>(value)
  // A completed range restarts on the next click; a half-open one closes.
  const [pendingStart, setPendingStart] = useState(false)
  const [month, setMonth] = useState(() =>
    startOfMonth(value.from ? parseIso(value.from) : new Date()),
  )
  const rootRef = useRef<HTMLDivElement>(null)

  // Reopening always shows the committed range, not last time's abandoned draft.
  useEffect(() => {
    if (!open) return
    setDraft(value)
    setPendingStart(false)
    setMonth(startOfMonth(value.from ? parseIso(value.from) : new Date()))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const today = useMemo(() => new Date(), [])
  const activeQuick = quickRanges.find((q) => {
    const r = q.range(today)
    return (r.from ?? '') === (draft.from ?? '') && (r.to ?? '') === (draft.to ?? '')
  })

  // Six weeks from the Sunday on/before the 1st — a fixed grid, so the popover
  // doesn't change height as the user pages through months.
  const gridStart = startOfWeek(startOfMonth(month))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  function pick(day: Date) {
    const s = iso(day)
    if (!draft.from || !pendingStart) {
      setDraft({ from: s, to: undefined })
      setPendingStart(true)
      return
    }
    if (s < draft.from) setDraft({ from: s, to: draft.from })
    else setDraft({ from: draft.from, to: s })
    setPendingStart(false)
  }

  function apply() {
    // A half-finished range means a single day.
    onChange(draft.from && !draft.to ? { from: draft.from, to: draft.from } : draft)
    setOpen(false)
  }

  const dayClass =
    'flex h-6 w-8 items-center justify-center rounded-[6px] font-display text-[12px] font-medium'

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1 rounded-lg border bg-white py-2 pl-2 pr-1.5"
        style={{ borderColor: C.line }}
      >
        <span className="flex items-center gap-1.5">
          <CalendarGlyph />
          <span
            className="whitespace-nowrap font-display text-[12px] font-medium"
            style={{ color: C.sub }}
          >
            {formatDateRange(value, allLabel)}
          </span>
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.sub} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select a date range"
          className={`absolute top-full z-50 mt-2 flex overflow-hidden rounded-[16px] border bg-white shadow-[0px_11px_24px_rgba(0,0,0,0.1),0px_43px_43px_rgba(0,0,0,0.09)] ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ borderColor: C.line }}
        >
          {/* Quick ranges */}
          <div className="flex flex-col gap-1.5 border-r p-3" style={{ borderColor: C.line }}>
            <span className="font-display text-[12px] font-medium" style={{ color: C.faint }}>
              Quick ranges
            </span>
            <div className="flex flex-col items-stretch">
              {quickRanges.map((q) => {
                const on = activeQuick?.id === q.id
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => {
                      const r = q.range(new Date())
                      setDraft(r)
                      setPendingStart(false)
                      if (r.from) setMonth(startOfMonth(parseIso(r.from)))
                    }}
                    className="flex h-8 items-center whitespace-nowrap rounded-lg p-2 text-left font-display text-[14px] font-medium"
                    style={{
                      backgroundColor: on ? C.brandWash : undefined,
                      color: on ? C.brand : C.sub,
                    }}
                  >
                    {q.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Calendar */}
          <div className="flex flex-col items-end gap-3 p-3">
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setMonth(addMonths(month, -1))}
                className="flex size-8 items-center justify-center rounded-lg border bg-white"
                style={{ borderColor: C.line }}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} color={C.ink} />
              </button>
              <span className="font-display text-[12px] font-medium" style={{ color: C.ink }}>
                {MONTHS[month.getMonth()]} {month.getFullYear()}
              </span>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setMonth(addMonths(month, 1))}
                className="flex size-8 items-center justify-center rounded-lg border bg-white"
                style={{ borderColor: C.line }}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} color={C.ink} />
              </button>
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="flex gap-0.5">
                {WEEKDAYS.map((d, i) => (
                  <span key={i} className={dayClass} style={{ color: C.faint }}>
                    {d}
                  </span>
                ))}
              </div>
              {Array.from({ length: 6 }, (_, w) => (
                <div key={w} className="flex gap-0.5">
                  {days.slice(w * 7, w * 7 + 7).map((d) => {
                    const s = iso(d)
                    const outside = d.getMonth() !== month.getMonth()
                    const isEnd = s === draft.from || s === draft.to
                    const inRange =
                      draft.from != null && draft.to != null && s > draft.from && s < draft.to
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => pick(d)}
                        className={dayClass}
                        style={{
                          backgroundColor: isEnd ? C.brand : inRange ? C.brandWash : undefined,
                          color: isEnd
                            ? C.brandWash
                            : inRange
                              ? C.brand
                              : outside
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

            <div className="flex w-full items-center">
              <span
                className="flex h-8 flex-1 items-center justify-center rounded-lg border bg-white px-2 font-display text-[12px] font-medium"
                style={{ borderColor: C.line, color: C.body }}
              >
                {draft.from ? fmtDay(draft.from) : '—'}
              </span>
              <span
                className="flex size-8 items-center justify-center font-display text-[12px] font-medium"
                style={{ color: C.ink }}
              >
                -
              </span>
              <span
                className="flex h-8 flex-1 items-center justify-center rounded-lg border bg-white px-2 font-display text-[12px] font-medium"
                style={{ borderColor: C.line, color: C.body }}
              >
                {draft.to ? fmtDay(draft.to) : '—'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 items-center rounded-lg border bg-white px-3 font-display text-[14px] font-medium"
                style={{ borderColor: C.line, color: C.brand }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="flex h-8 items-center rounded-lg px-3 font-display text-[14px] font-medium text-white"
                style={{ backgroundColor: C.brand }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// The trigger's calendar glyph (Figma "calendar-04"). Drawn inline rather than
// pulled from the icon set so the 16px box matches the design exactly.
function CalendarGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3.3" width="12" height="11" rx="2.5" stroke={C.sub} strokeWidth="1.2" />
      <path d="M2 6.8h12" stroke={C.sub} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.3 1.8v2.6M10.7 1.8v2.6" stroke={C.sub} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
