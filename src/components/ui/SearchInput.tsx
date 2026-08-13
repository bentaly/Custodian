import { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Search01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'

// The search box every listing screen wears — the same 40px wash-filled field as the
// app header's global search, so "search this list" and "search everything" read as one
// control in two places. That wash is now the app's ONE field surface (`fields.tsx`),
// which this box was simply the first to wear.
//
// It owns the debounce as well as the look. `value` is the *committed* term (in
// practice a URL search param) and `onChange` fires only after the user stops typing,
// which is the shape every caller was hand-rolling: keystrokes must not each push a
// history entry and a loader run.

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel,
  delay = 300,
  className = '',
}: {
  /** The committed term (e.g. the `q` search param). */
  value: string | undefined
  /** Fired `delay` ms after the last keystroke; `undefined` when cleared. */
  onChange: (next: string | undefined) => void
  placeholder?: string
  ariaLabel?: string
  delay?: number
  /** Width overrides — the field is full-width below `sm` on every screen. */
  className?: string
}) {
  const [term, setTerm] = useState(value ?? '')

  // A committed term changing underneath us (back button, a filter reset) wins over
  // whatever is in the box.
  useEffect(() => {
    setTerm(value ?? '')
  }, [value])

  useEffect(() => {
    const next = term.trim() || undefined
    if (next === (value || undefined)) return
    const t = setTimeout(() => onChange(next), delay)
    return () => clearTimeout(t)
  }, [term]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className={`flex h-10 w-full min-w-0 items-center gap-2 rounded-control px-3 sm:w-auto ${className}`}
      style={{ backgroundColor: C.wash }}
    >
      <HugeiconsIcon icon={Search01Icon} size={16} color={C.ink} />
      <input
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="w-full min-w-0 bg-transparent font-display text-body outline-hidden placeholder:text-grey-500 sm:w-52"
        style={{ color: C.ink }}
      />
    </div>
  )
}
