import { compactExact, fmtCompact } from '../../lib/format'
import { Tooltip } from './Tooltip'

// A money figure in its KPI-sized form — `£4.8k`, `£1.2m` — that hands over the exact
// number on hover and on focus.
//
// Compaction is a lie the reader can usually live with: on a dashboard meter, "how much
// of the round is gone" is the question and £45,300 answers it no better than £45k. It
// stops being liveable the moment the compact figure sits beside its own arithmetic. A
// £4,840 ask rendered "£5k" over "£2,420 per year for 2 years" — a total a reader could
// see did not add up, on the one screen where they are deciding whether to give the
// money. Rounding to two significant figures fixed the size of that error; this fixes
// what is left of it, by making the real number reachable rather than by spelling every
// figure out and giving up the compact form.
//
// **Only when something was actually rounded away.** `compactExact` returns null for
// `£5k` meaning exactly £5,000, and then this renders bare text with no trigger, no tab
// stop and no tooltip. A tooltip that opens to repeat what is already on screen is
// noise, and it makes the ones carrying a different number indistinguishable from it —
// the same rule `TruncatedText` follows for text that is not really clipped.
//
// It is `inline`, wrapper and trigger both, rather than the `Tooltip` default of
// `inline-flex`: these sit mid-sentence ("£4.8k committed of £5k budget") and inside
// `truncate` parents, and an inline-flex box in that company will not wrap and does not
// inherit the line's alignment.
//
// NOT for a figure whose exact value is already a hover away — the facet chips on
// Applications carry the whole phrase in a `title`, and two tooltips over one number is
// worse than none. And not `fmtMoney`'s job: where the exact figure is what the screen
// is FOR (an award, an instalment, a budget line), print it, don't hide it in a bubble.

export function CompactMoney({
  amount,
  label = 'Exact amount',
}: {
  amount: number
  /** Names the tooltip for a screen reader, e.g. "Exact amount requested". */
  label?: string
}) {
  const exact = compactExact(amount)
  const text = fmtCompact(amount)
  if (!exact) return <>{text}</>
  return (
    <Tooltip
      label={label}
      trigger={text}
      className="inline"
      triggerClassName="inline cursor-help rounded-chip focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
    >
      {exact}
    </Tooltip>
  )
}
