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
      const left = Math.min(Math.max(8, anchor.left), Math.max(8, window.innerWidth - w - 8))
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
  }, [open, matchWidth, anchorRef, panelRef])

  return pos
}

/** Close on a click outside either element, and on Escape. */
export function useDismiss(
  open: boolean,
  onClose: () => void,
  ...refs: RefObject<HTMLElement | null>[]
) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!refs.some((r) => r.current?.contains(t))) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      // Stopped, so a popover open over a dialog is what Escape closes first — without
      // this the dialog behind it takes the key and the whole form disappears.
      if (e.key === 'Escape') {
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
