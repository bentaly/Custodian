import { useId, useRef, useState } from 'react'

export function TagInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder = 'Add themes…',
  hint,
}: {
  id?: string
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder?: string
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
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

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

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
    }
    setInputValue('')
    setIsOpen(false)
    setActiveIndex(-1)
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
      <div
        className="flex min-h-10 cursor-text flex-wrap gap-1.5 rounded-control border border-gray-200 bg-white px-2 py-1.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-label font-medium text-gray-700"
          >
            {tag}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                removeTag(tag)
              }}
              className="leading-none text-gray-400 hover:text-gray-600"
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
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setIsOpen(true)
            setActiveIndex(-1)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() =>
            setTimeout(() => {
              setIsOpen(false)
              setActiveIndex(-1)
            }, 150)
          }
          onKeyDown={handleKeyDown}
          className="min-w-24 flex-1 border-none bg-transparent font-display text-body outline-hidden"
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>

      {(hint || value.length > 0) && (
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          {hint ? <p className="font-display text-label text-gray-500">{hint}</p> : <span />}
          {value.length > 0 && (
            // `aria-live` so the count is announced as chips are added: the chips
            // themselves are only reachable by moving through them one at a time.
            <p aria-live="polite" className="font-display text-label text-gray-400">
              {value.length} {value.length === 1 ? 'theme' : 'themes'}
            </p>
          )}
        </div>
      )}

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded-chip border border-gray-200 bg-white shadow-xs"
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => addTag(opt.value)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`cursor-pointer px-3 py-2 text-left text-body ${
                i === activeIndex ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'
              } ${i === options.length - 1 && showCreate ? 'text-gray-500' : ''}`}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
