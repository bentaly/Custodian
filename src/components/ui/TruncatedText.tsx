import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from './cn'
import { Tooltip } from './Tooltip'

// A line of text that says everything it has, truncates when it must, and hands the
// rest over on hover or focus.
//
// It replaces the "first item + N others" abbreviation the theme and programme lists
// used to carry. That summary lost every name but one at ALL widths, including the
// widths where the full list fitted comfortably — and the reader could not tell whether
// "+2" was two more themes or two hundred. Ellipsis is the honest version: the text is
// complete, the column shows as much of it as it has room for, and the tooltip is the
// remainder rather than a restatement.
//
// The tooltip is wired ONLY when the text is actually clipped. A trigger that opens to
// show you exactly what is already on screen is noise, and worse, it makes the ones
// that do carry something indistinguishable. Overflow is measured rather than guessed
// (`scrollWidth > clientWidth`) and re-measured on resize, because whether a list fits
// is a fact about this viewport, not about the string.

export function TruncatedText({
  text,
  label,
  className,
}: {
  /** The whole thing. Never pre-abbreviated — that is this component's job. */
  text: string
  /** Names the tooltip for a screen reader, e.g. "All programmes for this theme". */
  label: string
  className?: string
}) {
  const [clipped, setClipped] = useState(false)
  const el = useRef<HTMLSpanElement>(null)

  const measure = useCallback(() => {
    const node = el.current
    if (!node) return
    // +1: sub-pixel layout leaves `scrollWidth` a hair over `clientWidth` on text that
    // fits exactly, which otherwise puts a tooltip on half the rows in a table.
    setClipped(node.scrollWidth > node.clientWidth + 1)
  }, [])

  useEffect(() => {
    measure()
    const node = el.current
    if (!node) return
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(node)
    // Web fonts land AFTER the first measure, and swapping to one changes how wide the
    // TEXT is without changing the BOX it sits in — so `ResizeObserver`, which watches
    // the box, never fires. A line measured in the fallback face and found to fit would
    // then stay silent for good, however far the real face overflows it. `fonts.ready`
    // is the only signal for that, and this app draws every one of these in `font-display`.
    document.fonts?.ready.then(measure).catch(() => {})
    return () => ro?.disconnect()
    // `clipped` is a dependency because flipping it REPLACES the measured node: the span
    // moves inside the tooltip's wrapper. Without it the observer would be left watching
    // a node that is no longer in the document.
  }, [measure, text, clipped])

  const line = (
    <span ref={el} className={cn('block min-w-0 truncate', className)}>
      {text}
    </span>
  )

  if (!clipped) return line

  return (
    // The wrapper is told to be the same box the bare `line` was — a block that fills
    // its parent. Left as the tooltip's default `inline-flex` it would shrink to fit
    // instead, so the act of wrapping would change the width the clipping was measured
    // against, which is how a tooltip ends up flickering on and off at one exact size.
    <Tooltip
      label={label}
      trigger={line}
      className="block min-w-0"
      triggerClassName="block min-w-0 w-full cursor-default"
    >
      {text}
    </Tooltip>
  )
}

/**
 * The same, for a list of short labels — themes on a grant, programmes behind a theme.
 * The separator is stated once here so a comma-joined list on one screen is not a
 * middot-joined one on the next.
 */
export function TruncatedList({
  items,
  label,
  empty = '—',
  className,
}: {
  items: string[]
  label: string
  /** What to show when there is nothing — a dash, not an empty cell. */
  empty?: string
  className?: string
}) {
  if (items.length === 0) return <span className={className}>{empty}</span>
  return <TruncatedText text={items.join(', ')} label={label} className={className} />
}
