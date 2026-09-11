import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'

// Where a popover panel goes, for the controls that open one (`DateField`, `Listbox`).
//
// Panels are portalled to `document.body` and positioned in VIEWPORT coordinates rather
// than absolutely inside their trigger, because these controls live inside `Dialog`,
// whose body scrolls: an absolutely-positioned panel in there is clipped by the scroll
// container the moment it is taller than the space left below the field.

export type PopoverPos = { top: number; left: number; width: number }

export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  /** Match the panel's width to the trigger's — right for a select, wrong for a calendar. */
  matchWidth = false,
  /**
   * Which edge of the trigger the panel lines up with. `end` hangs it back from the
   * trigger's RIGHT edge — for a control at the right of a row (the award schedule's
   * Edit), where a panel opening rightwards would run off the card it belongs to.
   */
  align: 'start' | 'end' = 'start',
): PopoverPos | null {
  const [pos, setPos] = useState<PopoverPos | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const anchor = anchorRef.current?.getBoundingClientRect()
      if (!anchor) return
      const h = panelRef.current?.offsetHeight ?? 240
      const w = matchWidth ? anchor.width : (panelRef.current?.offsetWidth ?? anchor.width)
      // Flip above the trigger when there isn't room below it.
      const below = anchor.bottom + 6
      const top = below + h > window.innerHeight - 8 ? Math.max(8, anchor.top - 6 - h) : below
      const want = align === 'end' ? anchor.right - w : anchor.left
      const left = Math.min(Math.max(8, want), Math.max(8, window.innerWidth - w - 8))
      setPos({ top, left, width: anchor.width })
    }
    place()
    // Capture, so a scroll inside the dialog body moves the panel with the field.
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, matchWidth, align, anchorRef, panelRef])

  return pos
}

/**
 * Marks a portalled panel as a popover LAYER, so the layers beneath it can tell a click
 * or an Escape meant for it from one meant for them. Every panel opened through this
 * file should carry it.
 */
export const POPOVER_LAYER = { 'data-popover-layer': '' } as const

/**
 * Whether a popover layer other than this one is stacked ABOVE it. Panels portal to the
 * end of `document.body` in the order they open, so a layer later in the document was
 * opened later, from inside one of the earlier ones — a calendar opened from a field in
 * the award screen's edit popover is the case this exists for. Without it, picking a day
 * was a mousedown outside the edit popover, which closed it along with the half-made edit.
 */
function layerAbove(own: HTMLElement[], el: Element | null): boolean {
  if (!el || own.some((o) => o === el || o.contains(el))) return false
  return own.every((o) => o.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
}

/** Close on a click outside either element, and on Escape. */
export function useDismiss(
  open: boolean,
  onClose: () => void,
  ...refs: RefObject<HTMLElement | null>[]
) {
  useEffect(() => {
    if (!open) return
    const own = () => refs.map((r) => r.current).filter((el): el is HTMLElement => el != null)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (own().some((el) => el.contains(t))) return
      // A click inside a layer opened on top of this one belongs to that layer.
      if (t instanceof Element && layerAbove(own(), t.closest('[data-popover-layer]'))) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      // Stopped, so a popover open over a dialog is what Escape closes first — without
      // this the dialog behind it takes the key and the whole form disappears.
      if (e.key === 'Escape') {
        // Only the topmost layer answers. Every open layer listens on `document`, and
        // they fire in the order they OPENED, so without this the one underneath would
        // close first and take the one on top with it.
        const layers = Array.from(document.querySelectorAll('[data-popover-layer]'))
        if (layers.some((l) => layerAbove(own(), l))) return
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose]) // eslint-disable-line react-hooks/exhaustive-deps
}
