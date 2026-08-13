import { useEffect, useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'
import {
  CalendarPanel,
  addDays,
  addMonths,
  fmtDay,
  iso,
  parseIso,
  startOfMonth,
  startOfWeek,
} from './calendar'

// The app's date-range control (Figma 434:14112) — a filter pill that opens a
// quick-ranges list beside a two-click calendar. Shared because it appears on
// several screens (Insights, Applications, …); each caller only owns what the
// range means for its own data.
//
// The calendar itself is `CalendarPanel`, shared with `DateField`; only the two-ended
// selection logic and the quick-ranges column are this component's own.

/** Inclusive `yyyy-mm-dd` bounds. Both absent = no restriction ("All time"). */
export type DateRange = { from?: string; to?: string }

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

  // The trigger is a `FilterPill` in every respect but the popover it opens, so it
  // follows the same rule: Gray/900 text, glyph and caret in both states, and the brand
  // tint on the surface once a range is set.
  const on = value.from != null || value.to != null

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1 rounded-chip border py-2 pl-2 pr-1.5"
        style={{ borderColor: on ? C.brand : C.line, backgroundColor: on ? C.brandBg : '#fff' }}
      >
        <span className="flex items-center gap-1.5">
          <CalendarGlyph colour={C.ink} />
          <span
            className="whitespace-nowrap font-display text-body font-medium"
            style={{ color: C.ink }}
          >
            {formatDateRange(value, allLabel)}
          </span>
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.ink} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Select a date range"
          className={`absolute top-full z-50 mt-2 flex overflow-hidden rounded-card border bg-white shadow-[0px_11px_24px_rgba(0,0,0,0.1),0px_43px_43px_rgba(0,0,0,0.09)] ${align === 'right' ? 'right-0' : 'left-0'}`}
          style={{ borderColor: C.line }}
        >
          {/* Quick ranges */}
          <div className="flex flex-col gap-1.5 border-r p-3" style={{ borderColor: C.line }}>
            <span className="font-display text-label font-medium" style={{ color: C.faint }}>
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
                    className="flex h-8 items-center whitespace-nowrap rounded-chip p-2 text-left font-display text-body font-medium"
                    style={{
                      backgroundColor: on ? C.brandSecondary : undefined,
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
            <CalendarPanel
              month={month}
              onMonthChange={setMonth}
              toneFor={(s) =>
                s === draft.from || s === draft.to
                  ? 'selected'
                  : draft.from != null && draft.to != null && s > draft.from && s < draft.to
                    ? 'range'
                    : 'none'
              }
              onPick={pick}
            />

            <div className="flex w-full items-center">
              <span
                className="flex h-8 flex-1 items-center justify-center rounded-chip border bg-white px-2 font-display text-label font-medium"
                style={{ borderColor: C.line, color: C.body }}
              >
                {draft.from ? fmtDay(draft.from) : '—'}
              </span>
              <span
                className="flex size-8 items-center justify-center font-display text-label font-medium"
                style={{ color: C.ink }}
              >
                -
              </span>
              <span
                className="flex h-8 flex-1 items-center justify-center rounded-chip border bg-white px-2 font-display text-label font-medium"
                style={{ borderColor: C.line, color: C.body }}
              >
                {draft.to ? fmtDay(draft.to) : '—'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 items-center rounded-chip border bg-white px-3 font-display text-body font-medium"
                style={{ borderColor: C.line, color: C.brand }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="flex h-8 items-center rounded-chip px-3 font-display text-body font-medium text-white"
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
function CalendarGlyph({ colour = C.sub }: { colour?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="3.3" width="12" height="11" rx="2.5" stroke={colour} strokeWidth="1.2" />
      <path d="M2 6.8h12" stroke={colour} strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.3 1.8v2.6M10.7 1.8v2.6" stroke={colour} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
