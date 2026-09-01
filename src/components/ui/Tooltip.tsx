import {
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'

// The little ⓘ next to a field label that explains what the field is for — or, with
// `trigger`, any mark that needs explaining in place (a due diligence glyph in a table,
// a truncated list of programme names).
//
// Not a `title` attribute and not a hover-only div. `title` is unreachable by touch,
// invisible to most screen readers as a description, and appears after a delay nobody
// controls; hover-only means a keyboard user simply never sees the explanation. So:
// focusable, opened on hover and on focus, dismissed by Escape, and wired to the bubble
// with `aria-describedby` so the text is announced with the thing it explains.
//
// WHAT THE TRIGGER IS depends on what it wraps, and the distinction is not cosmetic:
//
//   • The ⓘ is a real `<button>`. It is a control in its own right — there is nothing
//     else there — so it toggles on click and announces as a button.
//   • A custom `trigger` wraps content that is ALREADY on the page and means something
//     without the tooltip. That gets a focusable `<span>`, not a button: a button that
//     ignores your click is a promise the page does not keep, and a status glyph is not
//     an action. `tabIndex={0}` and `role="note"` keep it reachable and announced,
//     which is the part `title` gives up.
//   • `control` is for a trigger that is ALREADY focusable — a button, a link. Wrapping
//     one in the `role="note"` span above would put a second tab stop around a control
//     that already has one, and announce a note wrapping a button. So the wrapper stays
//     inert and the DESCRIPTION is cloned onto the control itself: hover and focus are
//     handled on the wrapper (both bubble out of the control), while `aria-describedby`
//     has to sit on the focused element or no screen reader will read it.
//
// The bubble is PORTALLED to `document.body` and positioned `fixed`. It has to be: these
// live inside the round dialog's scrolling body, and an ancestor with `overflow` clips
// its descendants no matter what z-index they carry — the bubble was being sliced off.
// A portal has no such ancestor, which is also why the position must be measured from
// the trigger's viewport rect rather than expressed as an offset in the normal flow.

const GAP = 8
const EDGE = 8
// A CEILING, not a width. The bubble is `w-max`, so a two-word answer ("£4,840") draws a
// two-word bubble and only a real sentence reaches this and wraps. A fixed 224 made every
// tooltip the size of the longest one in the app, which around a short figure reads as an
// empty panel that happens to contain a number.
const MAX_WIDTH = 224
// Keeps the arrow off the bubble's rounded corners once the bubble is narrower than the
// distance the clamp moved it.
const ARROW_INSET = 10

type Position = { top: number; left: number; arrowLeft: number; below: boolean }

export function Tooltip({
  label,
  children,
  trigger,
  className,
  triggerClassName,
  control = false,
}: {
  /**
   * Accessible name for the trigger, e.g. "About max per award". Ignored when
   * `control` is set — the button or link already names itself, and a second name
   * over the top of it is how a control ends up announced as something it isn't.
   */
  label: string
  /** The explanation. Keep it to a sentence or two. */
  children: ReactNode
  /**
   * What the trigger draws. Omit for the ⓘ this component is named after; pass
   * something when the thing needing explanation is already on screen and a second
   * mark beside it would just be clutter — a status glyph in a table cell, say.
   * Wrapped in a focusable `<span role="note">` rather than a button — it is not an
   * action — so it keeps the focus, Escape and `aria-describedby` wiring that a
   * `title` attribute gives up.
   */
  trigger?: ReactNode
  /**
   * Replaces the wrapper's default `inline-flex`. The wrapper is a real box in the
   * layout, so where the trigger was a flex child carrying its own sizing — a chart
   * column with `h-full flex-1` — that sizing has to move out here, or the wrapper
   * collapses and takes the bar with it.
   */
  className?: string
  /** Replaces the custom trigger's default classes. Ignored for the ⓘ, which owns its
   *  own look, and for `control`, which adds no classes of its own. */
  triggerClassName?: string
  /**
   * The `trigger` is itself an interactive, focusable element (a `Button`, an
   * `AnchorButton`, a `Link`). It keeps its own tab stop and its own name; this just
   * describes it. The element must forward `aria-describedby` to its DOM node.
   */
  control?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)
  // Either shape of trigger; only `getBoundingClientRect` is ever called on it.
  const triggerEl = useRef<HTMLElement>(null)
  const bubble = useRef<HTMLSpanElement>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const t = triggerEl.current?.getBoundingClientRect()
      const b = bubble.current?.getBoundingClientRect()
      if (!t || !b) return

      // Above by default, flipped below only when there isn't room — a tooltip that
      // opens off the top of the window is worse than one that covers what follows.
      const below = t.top - GAP - b.height < EDGE
      const top = below ? t.bottom + GAP : t.top - GAP - b.height

      // Centred on the trigger, then pulled back inside the viewport. The arrow keeps
      // pointing at the trigger after that nudge, so a clamped bubble still says which
      // control it belongs to.
      // Measured, not `MAX_WIDTH`: the bubble sizes itself to its content, so centring on
      // the constant would offset every bubble narrower than the ceiling.
      const w = b.width
      const centre = t.left + t.width / 2
      const left = Math.max(EDGE, Math.min(centre - w / 2, window.innerWidth - w - EDGE))
      const arrowLeft = Math.min(Math.max(centre - left, ARROW_INSET), w - ARROW_INSET)
      setPos({ top, left, arrowLeft, below })
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

  // Shared by all three trigger shapes. Stopping a click from reaching a clickable row
  // underneath is the CELL's job, not this component's — see `DueDiligenceCell`.
  const shared = {
    'aria-describedby': open ? id : undefined,
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: () => setOpen(true),
    onBlur: () => setOpen(false),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    },
  }

  return (
    <span
      className={className ?? 'inline-flex'}
      // In `control` mode the wrapper is the measured box and the hover/focus target:
      // `mouseenter` on a span that tightly wraps the control is the control's own
      // hover, and `focus`/`blur` bubble out of it.
      {...(control
        ? {
            ref: triggerEl as React.Ref<never>,
            onMouseEnter: shared.onMouseEnter,
            onMouseLeave: shared.onMouseLeave,
            onFocus: shared.onFocus,
            onBlur: shared.onBlur,
            onKeyDown: shared.onKeyDown,
          }
        : {})}
    >
      {control ? (
        // Only the description is cloned on. Everything else the control already has.
        isValidElement<{ 'aria-describedby'?: string }>(trigger) ? (
          cloneElement(trigger, { 'aria-describedby': shared['aria-describedby'] })
        ) : (
          trigger
        )
      ) : trigger !== undefined ? (
        // No click handler on purpose. It opens on hover and on focus — and tapping a
        // `tabindex` element focuses it — so there is nothing a click could add except
        // the appearance of an action, which is what a `<button>` here got wrong.
        //
        // `tabIndex` on a `role="note"` is what the WAI tooltip pattern asks for on a
        // static trigger, and is the whole reason this beats a `title` for a keyboard
        // user. `no-noninteractive-tabindex` is configured to allow `note` for this one
        // case (`.oxlintrc.json`) — nothing else in the app should reach for it.
        <span
          {...shared}
          ref={triggerEl as React.Ref<never>}
          role="note"
          aria-label={label}
          tabIndex={0}
          className={
            triggerClassName ??
            'flex rounded-chip focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden'
          }
        >
          {trigger}
        </span>
      ) : (
        <button
          {...shared}
          ref={triggerEl as React.Ref<never>}
          type="button"
          aria-label={label}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className="flex rounded-full text-grey-400 transition-colors hover:text-grey-500 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
        >
          <HugeiconsIcon icon={InformationCircleIcon} size={14} color="currentColor" />
        </button>
      )}

      {open &&
        createPortal(
          <span
            ref={bubble}
            id={id}
            role="tooltip"
            className="pointer-events-none fixed z-[100] block w-max rounded-chip border border-grey-200 bg-white px-3 py-2 font-display text-label leading-snug font-normal text-grey-700 shadow-lg"
            style={{
              maxWidth: MAX_WIDTH,
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
