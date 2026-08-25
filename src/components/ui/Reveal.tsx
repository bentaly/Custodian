import { useEffect, useRef, useState } from 'react'

/**
 * Scroll-reveal: an element fades and rises into place the first time it is
 * scrolled to, then stays put. The motion is the app's existing one (`.tick`,
 * `.bar-grow` in globals.css) — same easing, same reduced-motion off switch — so a
 * screen of revealing panels reads as the rest of the app rather than an effect
 * bolted onto one route.
 *
 * **Once only.** A panel that re-animated every time it crossed the viewport turns
 * scrolling back up into a flicker.
 *
 * `shown` is returned as well as the props, because a chart that animates itself
 * (Recharts' entry tween, a bar's rise) has to be told when it is being looked at:
 * mounted on load, its animation finishes unwatched three screens below the fold.
 *
 * Spread `props` onto the element and give it `ref`:
 *
 * ```tsx
 * const r = useReveal()
 * <Panel innerRef={r.ref} {...r.props}>…</Panel>
 * ```
 *
 * Nothing here reads as an error if it never fires — except invisibility, so the
 * no-`IntersectionObserver` path shows everything at once rather than nothing.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        setShown(true)
        io.disconnect()
      },
      // A shallow bottom margin, not the usual 15-20%: a panel that comes to rest
      // entirely inside the excluded band never intersects and so stays hidden
      // forever. 5% of a viewport is smaller than any panel on the screen.
      { rootMargin: '0px 0px -5% 0px', threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return {
    ref,
    shown,
    props: { 'data-reveal': '', className: shown ? 'reveal-in' : '' },
  }
}
