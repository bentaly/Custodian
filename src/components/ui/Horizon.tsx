import type { ReactNode } from 'react'

// One card of a "what is coming at you" strip (Figma 665:25047) — the panel the designer
// put where Finance's KPI row used to be, and now Reports' too. What makes it worth
// sharing is the reason it replaced them: a horizon NAMES what is outstanding instead of
// only counting it. "4 overdue" tells you there is a problem; "Nature Learning Network,
// due 10 Jun" tells you whose, which is the next thing you were going to ask anyway.
//
// A horizon is never dropped for being empty. The three cards are the same three cards
// whatever the data, so "nothing due this month" is something the panel SAYS rather than
// something you infer from a card that isn't there — the same rule the filter row follows.
//
// The trailing slot is whatever the horizon is measured in (money on Finance, a due date
// on Reports), but it is styled here: the two panels should read as one object, and a
// caller free to pick its own type size is a caller that will eventually pick a different
// one.

export type HorizonItem = {
  key: string
  title: string
  subline: string
  trailing: ReactNode
  /** A row is interactive only where there is something to open. */
  onClick?: () => void
  disabled?: boolean
}

export function Horizon({
  label,
  colour,
  meta,
  empty,
  items,
  hidden = 0,
  hiddenNoun,
}: {
  label: string
  /** The horizon's own hue — dot, label and every row's trailing value. */
  colour: string
  /** The bucket's summary, right of the label: "£12,000 · 3". Omitted when empty. */
  meta?: ReactNode
  /** What the card says when the horizon is clear. */
  empty: string
  items: HorizonItem[]
  /** How many more the bucket holds than it names. */
  hidden?: number
  /** Singular noun for the "+n more" line — "payment", "report". */
  hiddenNoun: string
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-grey-200 bg-white p-1">
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-[5px] shrink-0 rounded-full"
            style={{ backgroundColor: colour }}
          />
          <span className="font-display text-title font-medium" style={{ color: colour }}>
            {label}
          </span>
        </span>
        {meta != null && (
          <span className="whitespace-nowrap font-display text-label font-medium text-grey-400 tabular-nums">
            {meta}
          </span>
        )}
      </div>
      <div
        className="flex flex-1 flex-col gap-3 rounded-control p-3"
        style={{ backgroundColor: `color-mix(in srgb, ${colour} 10%, transparent)` }}
      >
        {items.length === 0 ? (
          <p className="font-display text-body text-grey-400">{empty}</p>
        ) : (
          items.map((item) => <HorizonRow key={item.key} item={item} colour={colour} />)
        )}
        {hidden > 0 && (
          <p className="font-display text-label font-medium text-grey-500">
            +{hidden} more {hiddenNoun}
            {hidden === 1 ? '' : 's'} in this window
          </p>
        )}
      </div>
    </div>
  )
}

// Rows are separated by the container's `gap-3` alone — 12px, as the design has it
// (Figma 661:24659, a two-row card measuring 120px).
//
// This used to carry `border-t … pt-3` as well, which double-counted the separation:
// the gap AND the row's own top padding AND a divider, 25px where the design says 12,
// and a card 15px taller than it should be. The design separates rows by space, not by
// a rule, so the rule goes rather than the spacing being tuned around it.
const ROW = 'flex w-full items-center justify-between gap-3 text-left'

function HorizonRow({ item, colour }: { item: HorizonItem; colour: string }) {
  const inner = (
    <>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-display text-body font-medium text-grey-900">
          {item.title}
        </span>
        <span className="truncate font-display text-label text-grey-500">{item.subline}</span>
      </span>
      <span
        className="shrink-0 whitespace-nowrap font-display text-title font-medium tabular-nums"
        style={{ color: colour }}
      >
        {item.trailing}
      </span>
    </>
  )
  if (!item.onClick) return <div className={ROW}>{inner}</div>
  return (
    <button
      type="button"
      onClick={item.onClick}
      disabled={item.disabled}
      className={`${ROW} disabled:opacity-60`}
    >
      {inner}
    </button>
  )
}
