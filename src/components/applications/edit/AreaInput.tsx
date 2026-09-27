import { useEffect, useId, useMemo, useState } from 'react'
import { Input } from '../../ui'
import { C } from '../../ui/tokens'
import { listAreaNames, type AreaName } from '../../../server/fns/areas'

// The delivery area box, with suggestions: the districts, counties and regions the
// deprivation lookup can report on by name (`server/fns/areas.ts`). Picking one is a
// name certain to resolve; typing something else (a town, a postcode) is still allowed,
// and is what the geocoder is for.
//
// The list is fetched once per page load and filtered here, so typing costs nothing.

let namesOnce: Promise<AreaName[]> | null = null
function areaNames(): Promise<AreaName[]> {
  namesOnce ??= listAreaNames().catch((err) => {
    namesOnce = null
    throw err
  })
  return namesOnce
}

const MAX_SUGGESTIONS = 8

export function AreaInput({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}) {
  const listId = useId()
  const [names, setNames] = useState<AreaName[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    let live = true
    areaNames()
      .then((n) => live && setNames(n))
      .catch(() => {
        // No suggestions is a degraded box, not a broken one: it still takes text.
      })
    return () => {
      live = false
    }
  }, [])

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (q.length < 2) return []
    const starts = names.filter((n) => n.name.toLowerCase().startsWith(q))
    const contains = names.filter(
      (n) => !n.name.toLowerCase().startsWith(q) && n.name.toLowerCase().includes(q),
    )
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
  }, [names, value])

  const showing = open && matches.length > 0 && !disabled
  const pick = (n: AreaName) => {
    onChange(n.name)
    setOpen(false)
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={listId}
        aria-activedescendant={showing ? `${listId}-${active}` : undefined}
        autoComplete="off"
        className={className}
        value={value}
        disabled={disabled}
        placeholder="A town, district, county or postcode"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        // After a click on a suggestion has had its chance to land.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!showing) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => (a + 1) % matches.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => (a - 1 + matches.length) % matches.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            pick(matches[active]!)
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {showing && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-auto rounded-control border bg-white py-1"
          style={{ borderColor: C.line, boxShadow: '0 8px 24px rgba(20,28,36,0.12)' }}
        >
          {matches.map((n, i) => (
            <li
              key={`${n.kind}-${n.name}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 font-display text-body"
              style={{
                backgroundColor: i === active ? C.wash : undefined,
                color: C.ink,
              }}
              onMouseEnter={() => setActive(i)}
              // mousedown, not click: it lands before the input's blur closes the list.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(n)
              }}
            >
              <span>{n.name}</span>
              <span className="font-display text-label" style={{ color: C.faint }}>
                {n.kind}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
