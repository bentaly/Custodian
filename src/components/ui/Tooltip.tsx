import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'

// The little ⓘ next to a field label that explains what the field is for.
//
// It is a real `<button>`, not a `title` attribute or a hover-only div. `title` is
// unreachable by touch, invisible to most screen readers as a description, and appears
// after a delay nobody controls; hover-only means a keyboard user simply never sees the
// explanation. So: focusable, toggled by click or Enter/Space, dismissed by Escape, and
// wired to the bubble with `aria-describedby` so the text is announced with the field.
//
// The bubble is PORTALLED to `document.body` and positioned `fixed`. It has to be: these
// live inside the round dialog's scrolling body, and an ancestor with `overflow` clips
// its descendants no matter what z-index they carry — the bubble was being sliced off.
// A portal has no such ancestor, which is also why the position must be measured from
// the trigger's viewport rect rather than expressed as an offset in the normal flow.

const GAP = 8
const EDGE = 8
const WIDTH = 224

type Position = { top: number; left: number; arrowLeft: number; below: boolean }

export function Tooltip({
  label,
  children,
}: {
  /** Accessible name for the trigger, e.g. "About max per award". */
  label: string
  /** The explanation. Keep it to a sentence or two. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const t = trigger.current?.getBoundingClientRect()
      const b = bubble.current?.getBoundingClientRect()
      if (!t || !b) return

      // Above by default, flipped below only when there isn't room — a tooltip that
      // opens off the top of the window is worse than one that covers what follows.
      const below = t.top - GAP - b.height < EDGE
      const top = below ? t.bottom + GAP : t.top - GAP - b.height

      // Centred on the trigger, then pulled back inside the viewport. The arrow keeps
      // pointing at the trigger after that nudge, so a clamped bubble still says which
      // control it belongs to.
      const centre = t.left + t.width / 2
      const left = Math.min(Math.max(centre - WIDTH / 2, EDGE), window.innerWidth - WIDTH - EDGE)
      setPos({ top, left, arrowLeft: centre - left, below })
    }
    place()
    // `true` captures scrolls on any ancestor, including the dialog body — without it
    // the bubble stays put while the thing it points at slides away.
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  return (
    <span className="inline-flex">
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
        className="flex rounded-full text-grey-400 transition-colors hover:text-grey-500 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
      >
        <HugeiconsIcon icon={InformationCircleIcon} size={14} color="currentColor" />
      </button>

      {open &&
        createPortal(
          <span
            ref={bubble}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[100] block rounded-chip border border-grey-200 bg-white px-3 py-2 font-display text-label leading-snug font-normal text-grey-700 shadow-lg"
            style={{
              width: WIDTH,
              // Rendered before it has been measured so the measurement is possible at
              // all; hidden until then so it is never seen in the top-left corner.
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
            }}
          >
            {children}
            {pos && (
              <span
                aria-hidden="true"
                className={`absolute size-2 rotate-45 border-grey-200 bg-white ${
                  pos.below ? 'border-t border-l' : 'border-r border-b'
                }`}
                // -5px, not -4: the square is nudged half its width out of the bubble
                // and then one more pixel, so its own border covers the bubble's rather
                // than leaving a hairline across the base of the arrow.
                style={{
                  left: pos.arrowLeft,
                  marginLeft: -4,
                  top: pos.below ? -5 : undefined,
                  bottom: pos.below ? undefined : -5,
                }}
              />
            )}
          </span>,
          document.body,
        )}
    </span>
  )
}
