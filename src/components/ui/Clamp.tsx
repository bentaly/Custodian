import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import { Button } from './Button'

// A PARAGRAPH that paints a few lines and opens the rest in place — and deliberately
// not a tooltip.
//
// `TruncatedText` cannot do this job: it is `truncate`, which is `white-space: nowrap`,
// so it is one line by construction. Reusing `Tooltip` was the tempting alternative,
// since that is the pattern the app already sets for "there is more here than fits",
// but it is the wrong tool for THIS text, for three reasons that are properties of the
// content rather than of taste:
//
//   • The bubble is a fixed 224px and says so in its own header — "keep it to a
//     sentence or two". The text this was built for is a charity's own description of
//     its work, taken verbatim from its annual return, and its length is uncontrolled:
//     one sentence for a village hall, a full paragraph for Cancer Research UK. Two
//     hundred words in a 224px column is a ribbon the height of the viewport.
//   • The bubble is `pointer-events-none`, so anything taller than the screen cannot be
//     scrolled to, and nothing in it can be selected or copied.
//   • It closes on `mouseleave`. Reading a paragraph is not a hover-length task.
//
// Split into a hook and a control rather than shipped as one component, because the
// control does not belong under the text: a full-width disclosure BUTTON costs a row of
// vertical space on a card whose whole argument is that it fits beside something else.
// The chevron goes inline with the section's own heading, which costs nothing, and that
// means the toggle and the text it toggles sit in different parts of the tree.
//
// The full text is in the DOM either way — this clamps what is PAINTED, so find-in-page
// still finds it and a screen reader still reads all of it.

/**
 * Measures whether `text` overflows `lines` at its current width, and holds the
 * open/closed state.
 *
 * `clipped` is the point of the hook. A control that expands to reveal exactly what is
 * already on screen is noise, and worse, it makes the ones that do carry something
 * indistinguishable — the rule `TruncatedText` states and follows for the same reason.
 * Overflow is MEASURED (`scrollHeight > clientHeight`) rather than guessed from the
 * string's length, because whether a paragraph fits in two lines is a fact about this
 * column, at this width, in this font.
 */
export function useClamp(text: string | null | undefined, lines: keyof typeof CLAMP = 2) {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  const measure = useCallback(() => {
    const node = ref.current
    // Only meaningful while the clamp is on: with it off, `scrollHeight` and
    // `clientHeight` agree by definition, and measuring would retract the control from
    // under the reader mid-paragraph.
    if (!node || open) return
    // +1 for the sub-pixel slack a fractional line-height leaves on text that fits
    // exactly, which otherwise puts a chevron on half the cards on screen.
    setClipped(node.scrollHeight > node.clientHeight + 1)
  }, [open])

  useEffect(() => {
    measure()
    const node = ref.current
    if (!node) return
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(node)
    // Web fonts land after the first measure and change how much text a line holds
    // without changing the box, so `ResizeObserver` never fires for it — the same trap
    // `TruncatedText` documents. Every one of these is drawn in `font-display`.
    document.fonts?.ready.then(measure).catch(() => {})
    return () => ro?.disconnect()
  }, [measure, text])

  return {
    /** Put this on the paragraph itself. */
    ref,
    /** True only while there is something behind the fold. Gate the control on it. */
    clipped,
    open,
    toggle: useCallback(() => setOpen((v) => !v), []),
    /** The clamp class, or `undefined` once it is open. */
    className: open ? undefined : CLAMP[lines],
  }
}

/**
 * The chevron that opens it — the app's `Button` at `xs`, icon-only, `ghost`.
 *
 * It was a hand-rolled 20px square first, which was both too small to hit comfortably
 * and a control shape the app uses nowhere else. `ghost` is the variant `Button`
 * already names for exactly this job ("chrome — dismiss, toggle, show more"), and `xs`
 * is the in-card size, so the toggle now wears the same 28px box as every other small
 * action and picks up its hover, focus ring and disabled handling for free.
 *
 * The glyph SWAPS rather than rotating, because `Button` draws its own icon and there
 * is no seam to hang a transform on — which is also what `Disclosure` does, so the two
 * disclosures on this screen turn over the same way.
 *
 * `label` names what is behind the fold ("Read the full description"); the chevron
 * alone announces as nothing.
 */
export function ClampToggle({
  open,
  onToggle,
  label,
  hideLabel = 'Show less',
}: {
  open: boolean
  onToggle: () => void
  label: string
  hideLabel?: string
}) {
  return (
    <Button
      variant="ghost"
      size="xs"
      icon={open ? ArrowUp01Icon : ArrowDown01Icon}
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? hideLabel : label}
    />
  )
}

// Spelled out because Tailwind scans for whole class names — `line-clamp-${lines}`
// generates nothing.
const CLAMP = {
  2: 'line-clamp-2',
  3: 'line-clamp-3',
  4: 'line-clamp-4',
} as const
