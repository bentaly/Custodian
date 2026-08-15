import { useEffect, useId, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Alert02Icon } from '@hugeicons/core-free-icons'

export function TagInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder = 'Add themes…',
  hint,
  onPendingChange,
}: {
  id?: string
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder?: string
  /**
   * Uncommitted text currently in the box (`''` when there is none.)
   *
   * The blur warning below cannot save the case that actually loses data: clicking
   * **Save** blurs the input and submits the form in the same gesture, so the form is
   * away before any warning could render. A parent that can refuse to submit is the
   * only thing standing between "typed a theme" and "theme silently absent".
   */
  onPendingChange?: (pending: string) => void
  /**
   * How to use the control, e.g. "Press Enter to add a theme". Worth stating: a box
   * that turns text into a chip on Enter looks exactly like a text field that doesn't,
   * and people type a comma-separated list into it and lose the lot on submit.
   */
  hint?: string
}) {
  const [inputValue, setInputValue] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  // Text left in the box when focus went elsewhere — typed but never turned into a chip.
  // A box that only commits on Enter looks exactly like a text field that commits on
  // submit, so this is the failure people actually hit: they type "Youth work", click
  // Save, and the theme is silently not there. The text is NOT cleared and nothing is
  // added on their behalf — the warning just makes the gap visible and one click wide.
  const [stray, setStray] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const warningId = useId()

  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(inputValue.toLowerCase()) && !value.includes(s),
  )

  const inputTrimmed = inputValue.trim()
  const showCreate =
    inputTrimmed &&
    !suggestions.some((s) => s.toLowerCase() === inputTrimmed.toLowerCase()) &&
    !value.some((v) => v.toLowerCase() === inputTrimmed.toLowerCase())

  // Unified option list so arrow-key indexing is straightforward.
  const options: { label: string; value: string }[] = [
    ...filtered.map((s) => ({ label: s, value: s })),
    ...(showCreate ? [{ label: `Create "${inputTrimmed}"`, value: inputTrimmed }] : []),
  ]

  const showDropdown = isOpen && options.length > 0

  // Reported as it is typed, not on blur, so the parent's answer is already correct by
  // the time a Save click arrives.
  useEffect(() => {
    onPendingChange?.(inputTrimmed)
  }, [inputTrimmed]) // eslint-disable-line react-hooks/exhaustive-deps

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
    }
    setInputValue('')
    setIsOpen(false)
    setActiveIndex(-1)
    setStray('')
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIsOpen(true)
      setActiveIndex((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && options[activeIndex]) {
        addTag(options[activeIndex]!.value)
      } else if (inputTrimmed) {
        addTag(inputTrimmed)
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]!)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setActiveIndex(-1)
    }
  }

  return (
    <div className="relative">
      {/* A <label>, not a div with an onClick: clicking anywhere in the box should put
          the cursor in the input, and that is what a label natively does — for pointer
          and assistive tech alike, with no handler to keep working. */}
      <label
        htmlFor={id}
        className="flex min-h-10 cursor-text flex-wrap gap-1.5 rounded-control bg-grey-100 px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand/20"
      >
        {value.map((tag) => (
          <span
            key={tag}
            // White on the wash, not the other way round: the field itself is now
            // Gray/100, so a Gray/100 chip on it would have no edge at all.
            className="flex items-center gap-1 rounded-full border border-grey-200 bg-white px-2.5 py-0.5 text-micro font-medium text-grey-700"
          >
            {tag}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                removeTag(tag)
              }}
              className="leading-none text-grey-400 hover:text-grey-600"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showDropdown}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-autocomplete="list"
          aria-describedby={stray ? warningId : undefined}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setIsOpen(true)
            setActiveIndex(-1)
            // Typing again is the user already dealing with it.
            setStray('')
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setIsOpen(false)
              setActiveIndex(-1)
              // Read the DOM, not `inputValue`: this runs 150ms later (the delay that
              // lets a click on a suggestion land first), by which time committing has
              // already emptied the box — so a picked suggestion never warns.
              setStray(inputRef.current?.value.trim() ?? '')
            }, 150)
          }
          onKeyDown={handleKeyDown}
          className="min-w-24 flex-1 border-none bg-transparent font-display text-body outline-hidden"
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </label>

      {stray && (
        // `status`, not `alert`: nothing has failed yet and the text is still in the
        // box — this is a nudge, and an assertive live region would interrupt whatever
        // the user moved on to do.
        <p
          id={warningId}
          role="status"
          className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-chip border border-warning/20 bg-warning/10 px-3 py-2 text-label leading-relaxed text-warning"
        >
          <HugeiconsIcon icon={Alert02Icon} size={16} strokeWidth={1.8} className="shrink-0" />
          <span>“{stray}” isn't added yet.</span>
          <button
            type="button"
            onClick={() => {
              addTag(stray)
              inputRef.current?.focus()
            }}
            className="font-medium underline underline-offset-2"
          >
            Add it
          </button>
          <span>or press Enter in the box.</span>
        </p>
      )}

      {(hint || value.length > 0) && (
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          {hint ? <p className="font-display text-label text-grey-500">{hint}</p> : <span />}
          {value.length > 0 && (
            // `aria-live` so the count is announced as chips are added: the chips
            // themselves are only reachable by moving through them one at a time.
            <p aria-live="polite" className="font-display text-label text-grey-400">
              {value.length} {value.length === 1 ? 'theme' : 'themes'}
            </p>
          )}
        </div>
      )}

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          // The same inverted panel `ListboxPanel` draws — Gray/100 behind a raised
          // white row — so the app has one dropdown, not two that nearly match.
          className="absolute z-10 mt-1 w-full rounded-control bg-grey-100 p-1.5 shadow-[0px_11px_24px_rgba(0,0,0,0.1)]"
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => addTag(opt.value)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`flex h-9 cursor-pointer items-center rounded-chip px-2.5 text-left text-body ${
                i === activeIndex
                  ? 'bg-white text-grey-900 ring-1 ring-grey-200 ring-inset'
                  : 'text-grey-500'
              }`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
