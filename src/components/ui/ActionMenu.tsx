import { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { MoreVerticalIcon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'

// The kebab in the corner of a card: one button that opens the handful of things you can
// do to the thing it sits on. Used where the actions are secondary to the content — a
// row of buttons competes with the record for attention, and reads as louder the more
// there is to do.
//
// A real menu, not a styled popover: `aria-haspopup`/`aria-expanded` on the trigger,
// `role="menu"` + `role="menuitem"` on the list, arrow keys and Home/End to move, Enter
// or Space to choose, Escape to leave — and focus goes back to the trigger afterwards,
// so keyboard users don't land at the top of the document.
//
// Positioned absolutely rather than portalled, unlike `Tooltip`: menus open from card
// corners in ordinary page flow, and nothing here clips them. If one ever opens inside a
// scrolling container, that is the day it needs the portal treatment too.

export type MenuAction = {
  label: string
  onSelect: () => void
  icon?: Parameters<typeof HugeiconsIcon>[0]['icon']
  /** Renders in danger red. For the one item that takes something away. */
  destructive?: boolean
  disabled?: boolean
}

export function ActionMenu({
  actions,
  label = 'Actions',
  className,
}: {
  actions: MenuAction[]
  /** Accessible name for the trigger — say what it acts on, e.g. "Actions for Spring 2026". */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<Array<HTMLButtonElement | null>>([])

  const enabled = actions.filter((a) => !a.disabled)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open && active >= 0) items.current[active]?.focus()
  }, [open, active])

  function close(restoreFocus = true) {
    setOpen(false)
    setActive(-1)
    if (restoreFocus) trigger.current?.focus()
  }

  function openAt(index: number) {
    setOpen(true)
    setActive(index)
  }

  function move(delta: number) {
    setActive((i) => {
      const next = i + delta
      if (next < 0) return actions.length - 1
      if (next >= actions.length) return 0
      return next
    })
  }

  if (enabled.length === 0) return null

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? close() : openAt(-1))}
        onKeyDown={(e) => {
          // Down opens onto the first item, Up onto the last — the convention that lets
          // you pick the bottom action without tabbing through everything above it.
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            openAt(0)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            openAt(actions.length - 1)
          }
        }}
        className="flex size-8 items-center justify-center rounded-chip text-grey-500 transition-colors hover:bg-grey-100 hover:text-grey-700 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
      >
        <HugeiconsIcon icon={MoreVerticalIcon} size={18} color="currentColor" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              close()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              move(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              move(-1)
            } else if (e.key === 'Home') {
              e.preventDefault()
              setActive(0)
            } else if (e.key === 'End') {
              e.preventDefault()
              setActive(actions.length - 1)
            } else if (e.key === 'Tab') {
              // Tabbing out of a menu dismisses it; letting focus walk into the page
              // behind an open menu is how you end up typing into a hidden field.
              close(false)
            }
          }}
          className="absolute top-full right-0 z-30 mt-1 min-w-44 overflow-hidden rounded-chip border bg-white py-1 shadow-lg"
          style={{ borderColor: C.line }}
        >
          {actions.map((action, i) => (
            <button
              key={action.label}
              ref={(node) => {
                items.current[i] = node
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              disabled={action.disabled}
              onClick={() => {
                close()
                action.onSelect()
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left font-display text-body font-medium transition-colors focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-40',
                action.destructive
                  ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                  : 'text-grey-700 hover:bg-grey-50 focus:bg-grey-50',
              )}
            >
              {action.icon && <HugeiconsIcon icon={action.icon} size={16} color="currentColor" />}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
