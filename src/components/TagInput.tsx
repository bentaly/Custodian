import { useId, useRef, useState } from 'react'

export function TagInput({
  value,
  onChange,
  suggestions,
  placeholder = 'Add themes…',
}: {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions: string[]
  placeholder?: string
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
        className="flex min-h-[40px] cursor-text flex-wrap gap-1.5 rounded border border-gray-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-gray-400"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700"
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
          className="min-w-24 flex-1 border-none bg-transparent text-sm outline-none"
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 w-full rounded border border-gray-200 bg-white shadow-sm"
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => addTag(opt.value)}
              onMouseEnter={() => setActiveIndex(i)}
              className={`cursor-pointer px-3 py-2 text-left text-sm ${
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
