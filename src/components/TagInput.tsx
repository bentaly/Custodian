import { useRef, useState } from 'react'

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
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(inputValue.toLowerCase()) && !value.includes(s),
  )

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed])
    }
    setInputValue('')
    setIsOpen(false)
  }

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (inputValue.trim()) addTag(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]!)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const inputTrimmed = inputValue.trim()
  const showCreate =
    inputTrimmed &&
    !suggestions.some((s) => s.toLowerCase() === inputTrimmed.toLowerCase()) &&
    !value.some((v) => v.toLowerCase() === inputTrimmed.toLowerCase())
  const showDropdown = isOpen && (filtered.length > 0 || !!showCreate)

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
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          onKeyDown={handleKeyDown}
          className="min-w-24 flex-1 border-none bg-transparent text-sm outline-none"
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>
      {showDropdown && (
        <div className="absolute z-10 mt-1 w-full rounded border border-gray-200 bg-white shadow-sm">
          {filtered.map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={() => addTag(tag)}
              className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              {tag}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseDown={() => addTag(inputTrimmed)}
              className="block w-full px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50"
            >
              Create "{inputTrimmed}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}
