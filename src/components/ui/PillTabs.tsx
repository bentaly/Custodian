import { useLayoutEffect, useRef, useState } from 'react'
import { C } from './tokens'

// The quiet filter switch in a card's title row (Figma 1347:1094) — Everything / Payments
// / Reports over the award screen's schedule. Plain words, and the chosen one sits in a
// tinted pill that SLIDES to whichever is picked, so the switch reads as one control
// moving rather than three buttons taking turns to light up.
//
// Not `Tabs`. That is the washed segmented track the lists switch between whole views
// with; this narrows the rows of a single card, and it is drawn small and light so it
// does not compete with the card's title for the eye.

export type PillTabItem<T> = { id: T; label: string }

export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: PillTabItem<T>[]
  value: T
  onChange: (id: T) => void
  ariaLabel: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  // Where the pill sits, measured off the chosen button. Null until the first layout —
  // on the server and for that first frame the chosen button wears the tint itself, so
  // there is never a frame with nothing marked.
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const on = trackRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (on) setPill({ left: on.offsetLeft, width: on.offsetWidth })
    }
    place()
    // A web font landing late changes every label's width.
    window.addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => window.removeEventListener('resize', place)
  }, [value])

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={ariaLabel}
      className="relative flex items-center"
    >
      {pill && (
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-pill transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
          style={{ left: pill.left, width: pill.width, backgroundColor: C.successWash }}
        />
      )}
      {items.map((t) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className="relative flex h-6 items-center whitespace-nowrap rounded-pill px-2 font-display text-label font-medium transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
            style={{
              color: on ? C.success : C.sub,
              backgroundColor: on && !pill ? C.successWash : undefined,
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
