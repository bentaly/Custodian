import type { ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { Boundary } from './Boundary'
import { initials } from './Avatar'
import { C } from './tokens'

// The furniture every detail screen is built from — the application's, the grant's and
// the report's. Each had its own copy: three headers that agreed on nothing (one with a
// back arrow, one with a bare `<h1>`, one with a hand-styled anchor pretending to be a
// button), and two different section cards. Lifting them here is what makes a grant look
// like it belongs to the same app as the application it came from.

/**
 * One section of a detail screen, isolated behind its own error boundary.
 *
 * Detail screens are where the app's least predictable data lands — jsonb columns
 * holding AI- and third-party-produced shapes, destructured directly by the panels
 * below. Before the boundary, one unexpected null in any of them threw during render
 * and took the whole page with it. Now the rest of the page survives.
 */
export function Panel({
  children,
  className = '',
  label,
}: {
  children: ReactNode
  className?: string
  /** Names the failed section in the fallback, e.g. "Payments". */
  label?: string
}) {
  return (
    <div
      className={`rounded-card border bg-white p-4 ${className}`}
      style={{ borderColor: C.line }}
    >
      <Boundary label={label}>{children}</Boundary>
    </div>
  )
}

/** A panel's heading, with an optional slot for the action that belongs to it. */
export function PanelTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
        {children}
      </h2>
      {right}
    </div>
  )
}

/**
 * A stated fact in a panel's grid: a quiet label over the value, with an optional
 * qualifier under it ("£5,000 above", "as requested"). Deliberately not a table — these
 * are four or five facts read at a glance, not rows to be scanned or sorted.
 */
export function KeyFact({
  label,
  value,
  sub,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="font-display text-label uppercase tracking-wide" style={{ color: C.faint }}>
        {label}
      </p>
      <p className="mt-0.5 truncate font-display text-body font-medium" style={{ color: C.ink }}>
        {value}
      </p>
      {sub && (
        <p className="truncate font-display text-label" style={{ color: C.faint }}>
          {sub}
        </p>
      )}
    </div>
  )
}

/**
 * The status pill in a detail header (Figma 435:42454) — a coloured dot and a label.
 *
 * Two tones, and the choice is about what the status IS, not about emphasis:
 *
 *   `neutral` — the record's state is a fact you'd read in passing (a report received,
 *      an application for review). The name is what the eye should land on, so the pill
 *      recedes and only the dot carries colour. This is the comp's treatment.
 *   `toned` — the state is the headline. A grant is Active, Complete or Cancelled, and
 *      which one governs whether money is still moving; that answer arriving in grey
 *      made the most consequential word on the screen the quietest.
 */
export function HeaderPill({
  colour,
  tone = 'neutral',
  children,
}: {
  colour: string
  tone?: 'neutral' | 'toned'
  children: ReactNode
}) {
  const toned = tone === 'toned'
  return (
    <span
      className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 font-display text-label font-medium"
      style={{
        backgroundColor: toned ? `color-mix(in srgb, ${colour} 10%, transparent)` : C.wash,
        color: toned ? colour : C.sub,
      }}
    >
      <span className="size-[3px] rounded-full" style={{ backgroundColor: colour }} />
      {children}
    </span>
  )
}

/**
 * The identity row a detail screen opens with: the way back, a monogram, who this record
 * is and what it belongs to, its status, and the actions it offers.
 *
 * The monogram uses the same `initials` as the list tables, so the tile you clicked in
 * the table is the tile at the top of the screen you land on.
 */
export function DetailHeader({
  backTo,
  backSearch,
  backLabel,
  name,
  subline,
  status,
  actions,
}: {
  backTo: LinkProps['to']
  /**
   * The list's own search, so the arrow returns the reader to the list they LEFT — the
   * round and programme being read, the filters, the sort, the page — rather than a
   * freshly defaulted one. Every detail screen does this the same way: the row carries
   * its list's search onto the detail route, the detail route validates the same shape
   * with `lib/listSearch`'s parser, and hands it straight back here. Empty (`{}`) when
   * the reader arrived from somewhere with no list behind it, which lands on the plain
   * list. See `lib/listSearch` for the convention in full.
   */
  backSearch?: LinkProps['search']
  /** Announced to screen readers, e.g. "Back to awards". */
  backLabel: string
  name: string
  /** The one line saying what this record belongs to — programme, round, dates. */
  subline: ReactNode
  status?: { label: string; colour: string; tone?: 'neutral' | 'toned' }
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        to={backTo}
        search={backSearch}
        aria-label={backLabel}
        className="flex shrink-0 items-center justify-center rounded-chip border bg-white p-2"
        style={{ borderColor: C.line }}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} color={C.ink} />
      </Link>

      <div className="flex min-w-[240px] flex-1 items-center gap-2">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-chip"
          style={{ backgroundColor: C.wash }}
        >
          <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
            {initials(name)}
          </span>
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-body font-medium" style={{ color: C.ink }}>
            {name}
          </h1>
          <p className="truncate font-display text-label" style={{ color: C.sub }}>
            {subline}
          </p>
        </div>
      </div>

      {status && (
        <HeaderPill colour={status.colour} tone={status.tone}>
          {status.label}
        </HeaderPill>
      )}

      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
