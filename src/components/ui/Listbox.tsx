import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkSquare02Icon, Search01Icon, SquareIcon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'
import { POPOVER_LAYER, useAnchoredPopover, useDismiss } from './popover'

// The app's dropdown panel (Figma 769:16020) — an INVERTED list: the panel is Gray/100
// and the active option is a white pill on top of it, rather than the usual white panel
// with a tinted active row. That inversion is the whole reason this exists: a native
// `<option>` list cannot be styled to it in any browser, so the panel is ours.
//
// What the native control gave away for free and this has to earn back: arrow-key
// navigation, Home/End, Enter/Space to commit, Escape to back out, typeahead, and the
// combobox/listbox roles a screen reader needs. Focus stays on the TRIGGER the whole
// time and the active option is named by `aria-activedescendant`, which is what keeps a
// portalled panel legible to assistive tech — moving focus into the panel would take it
// out of the dialog the trigger sits in.
//
// Touch is deliberately not special-cased: the panel is a 36px-row list, which is a
// bigger target than a native picker row, and one behaviour beats two.
//
// Two shapes share the panel and the keyboard contract: `Listbox` picks one value and
// closes, `MultiListbox` ticks values and STAYS OPEN, because a panel that shut after
// every tick would make choosing three themes three trips. Its rows draw the app's tick
// box (the `Checkbox` glyphs) — the white pill is only ever the keyboard's position
// there, since several rows can be chosen at once and one pill cannot say which.
//
// ── Searching inside the panel ───────────────────────────────────────────────────────
// A `MultiListbox` given `search` draws a search box at the top of the panel and is
// then the one case where focus DOES move: into that box, because it has to take
// keystrokes. The keyboard contract moves with it (arrows, Enter to tick, Tab and
// Escape out), minus the three keys that belong to the text — Space types a space, and
// Home/End move the caret — and minus typeahead, which the box replaces. When the panel
// shuts with focus lost to the page, it goes back to the trigger.
//
// The panel is a FIXED width in that mode, so it does not change size under the pointer
// as the list filters, and long names truncate (with the full text on hover). The caller
// does the filtering; the panel only draws what it is given.

export type ListboxOption = {
  value: string
  label: string
  disabled?: boolean
  /** A second, smaller grey line beneath the label — what KIND of thing it is. */
  description?: string
  /** Not an option at all: a line of text in the list ("No locations match"). */
  note?: boolean
}

export type ListboxSearch = {
  value: string
  onChange: (value: string) => void
  placeholder: string
}

const ROW =
  'flex h-9 w-full items-center gap-2 rounded-chip px-2.5 text-left font-display text-body transition-colors'

export function ListboxPanel({
  anchorRef,
  options,
  value,
  selected,
  onSelect,
  onClose,
  labelledBy,
  id,
  activeId,
  onActiveChange,
  search,
}: {
  anchorRef: RefObject<HTMLElement | null>
  options: ListboxOption[]
  value?: string | undefined
  /**
   * Multi-select: every value currently ticked. Given, the rows draw tick boxes, the
   * listbox announces itself as multi-selectable, and picking a row leaves it open.
   */
  selected?: readonly string[]
  onSelect: (value: string) => void
  onClose: () => void
  labelledBy?: string
  /** The listbox's own id, so the trigger can point `aria-controls` at it. */
  id: string
  /** Index of the keyboard-highlighted option, owned by the trigger. */
  activeId: number
  onActiveChange: (index: number) => void
  /** Draws the search box and takes focus into it — see the header. */
  search?: ListboxSearch & { onKeyDown: (e: React.KeyboardEvent) => void }
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  // Sized to its own fixed width when searchable, so the viewport clamp measures the
  // panel rather than the (narrower) chip.
  const pos = useAnchoredPopover(true, anchorRef, panelRef, !search)
  useDismiss(true, onClose, anchorRef, panelRef)
  const multiple = selected !== undefined
  const isOn = (v: string) => (multiple ? selected.includes(v) : v === value)

  // Keep the highlighted row in view when the arrow keys walk past the panel's edge.
  useEffect(() => {
    panelRef.current
      ?.querySelector(`[data-index="${activeId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return createPortal(
    <div
      ref={panelRef}
      {...POPOVER_LAYER}
      id={id}
      role="listbox"
      aria-labelledby={labelledBy}
      aria-multiselectable={multiple || undefined}
      // `aria-activedescendant` lives on the TRIGGER, not here: it must sit on the
      // focused element, and focus never leaves the combobox button.
      className={cn(
        'fixed z-[60] max-h-72 overflow-y-auto rounded-control p-1.5 shadow-[0px_11px_24px_rgba(0,0,0,0.1),0px_43px_43px_rgba(0,0,0,0.09)]',
        search && 'w-72 max-w-[calc(100vw-16px)]',
      )}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        minWidth: pos?.width,
        backgroundColor: C.wash,
        // Hidden until placed, so it never paints for a frame in the top-left corner.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {search && (
        // Pinned to the top of the scrolling panel, on the panel's own wash, so rows
        // scroll away beneath it rather than taking the box with them.
        <div
          className="sticky -top-1.5 z-10 -mx-1.5 -mt-1.5 mb-1 px-1.5 pt-1.5 pb-1"
          style={{ backgroundColor: C.wash }}
        >
          <div
            className="flex h-8 items-center gap-2 rounded-chip px-2.5"
            style={{ backgroundColor: C.white, boxShadow: `inset 0 0 0 1px ${C.line}` }}
          >
            <HugeiconsIcon icon={Search01Icon} size={16} color={C.sub} />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus -- opening the panel IS asking to type
              autoFocus
              type="text"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              onKeyDown={search.onKeyDown}
              placeholder={search.placeholder}
              aria-label={search.placeholder}
              role="combobox"
              aria-expanded
              aria-autocomplete="list"
              aria-controls={id}
              aria-activedescendant={activeId >= 0 ? `${id}-opt-${activeId}` : undefined}
              className="min-w-0 flex-1 bg-transparent font-display text-body text-grey-900 outline-hidden placeholder:text-grey-500"
            />
          </div>
        </div>
      )}
      {options.length === 0 && (
        <p className={cn(ROW, 'justify-center')} style={{ color: C.sub }}>
          Nothing to choose from
        </p>
      )}
      {options.map((o, i) => {
        if (o.note) {
          return (
            <p key={o.value} className={cn(ROW, 'h-auto min-h-9 py-2')} style={{ color: C.sub }}>
              {o.label}
            </p>
          )
        }
        const on = isOn(o.value)
        // Single-select: the white pill marks BOTH the chosen option and the one the
        // keyboard is on — they are the same affordance in this design, and only one can
        // be true at a time because arrowing around is what moves the highlight. With
        // several chosen the tick box says which, and the pill is the keyboard alone.
        const raised = i === activeId || (!multiple && activeId < 0 && on)
        return (
          <button
            key={o.value}
            id={`${id}-opt-${i}`}
            data-index={i}
            type="button"
            role="option"
            aria-selected={on}
            disabled={o.disabled}
            onMouseEnter={() => !o.disabled && onActiveChange(i)}
            // Focus stays on the trigger, pointer or not. A clicked row would otherwise
            // take it — harmless when the panel shut on every pick, but a multi-select
            // stays open, and the arrow keys (handled on the trigger) went dead after
            // the first tick with the mouse.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (o.disabled) return
              onSelect(o.value)
              if (!multiple) onClose()
            }}
            title={search ? o.label : undefined}
            className={cn(
              ROW,
              o.description && 'h-auto min-h-9 py-1.5',
              o.disabled ? 'cursor-not-allowed' : 'cursor-pointer',
            )}
            style={{
              backgroundColor: raised && !o.disabled ? C.white : undefined,
              boxShadow: raised && !o.disabled ? `inset 0 0 0 1px ${C.line}` : undefined,
              color: o.disabled ? C.muted : raised || (multiple && on) ? C.ink : C.sub,
            }}
          >
            {multiple && (
              <span
                aria-hidden="true"
                className={cn('flex shrink-0 transition-opacity', on ? '' : 'opacity-30')}
              >
                <HugeiconsIcon
                  icon={on ? CheckmarkSquare02Icon : SquareIcon}
                  size={20}
                  color={C.success}
                />
              </span>
            )}
            {o.description ? (
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{o.label}</span>
                <span className="truncate text-label" style={{ color: C.sub }}>
                  {o.description}
                </span>
              </span>
            ) : (
              <span className="truncate">{o.label}</span>
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

/**
 * The open state and keyboard contract both shapes share. `commit` is what Enter/Space
 * does to the highlighted option; `closeOnCommit` is the one behavioural difference
 * between picking and ticking.
 */
function useListbox({
  options,
  disabled,
  initialIndex,
  commit,
  closeOnCommit,
  searchable = false,
}: {
  options: ListboxOption[]
  disabled?: boolean
  initialIndex: () => number
  commit: (value: string) => void
  closeOnCommit: boolean
  /** The keys run from a search box: Space, Home, End and typeahead belong to the text. */
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = useRef({ term: '', at: 0 })

  const pickable = (o: ListboxOption | undefined) => !!o && !o.disabled && !o.note
  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const n = (from + dir * i + options.length * 2) % options.length
      if (pickable(options[n])) return n
    }
    return from
  }

  function openAt() {
    const at = initialIndex()
    setActive(at >= 0 ? at : options.findIndex(pickable))
    setOpen(true)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openAt()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => step(a < 0 ? -1 : a, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => step(a < 0 ? 0 : a, -1))
    } else if (searchable && [' ', 'Home', 'End'].includes(e.key)) {
      // The search box's own keys.
      return
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(step(-1, 1))
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(step(0, -1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (pickable(o)) commit(o!.value)
      if (closeOnCommit) setOpen(false)
    } else if (e.key === 'Tab') {
      // From a search box, Tab would walk off the end of <body> (the panel is portalled
      // there), so it comes back to the trigger instead, one Tab from the next control.
      if (searchable) e.preventDefault()
      setOpen(false)
    } else if (e.key.length === 1 && !searchable) {
      // Typeahead: keystrokes within a second build a prefix, so "co" reaches
      // "Community & Place" rather than cycling the two options starting with C.
      const now = Date.now()
      typed.current = {
        term: (now - typed.current.at < 1000 ? typed.current.term : '') + e.key.toLowerCase(),
        at: now,
      }
      const hit = options.findIndex(
        (o) => pickable(o) && o.label.toLowerCase().startsWith(typed.current.term),
      )
      if (hit >= 0) setActive(hit)
    }
  }

  const triggerProps = (listId: string, ariaLabel?: string, labelledBy?: string) => ({
    type: 'button',
    role: 'combobox',
    'aria-expanded': open,
    'aria-haspopup': 'listbox',
    'aria-controls': open ? listId : undefined,
    'aria-activedescendant': open && active >= 0 ? `${listId}-opt-${active}` : undefined,
    'aria-label': ariaLabel,
    'aria-labelledby': labelledBy,
    disabled,
    onKeyDown,
    onClick: () => (open ? setOpen(false) : openAt()),
  })

  return {
    open,
    close: () => setOpen(false),
    active,
    setActive,
    triggerProps,
    onKeyDown,
    firstPickable: () => options.findIndex(pickable),
  }
}

/**
 * The whole control: a caller-drawn trigger plus the panel, with the keyboard contract
 * between them. `renderTrigger` gets the props the trigger MUST carry — spread them onto
 * a `<button>` and draw whatever chrome the screen wants inside it.
 */
export function Listbox({
  options,
  value,
  onChange,
  ariaLabel,
  labelledBy,
  disabled,
  className,
  renderTrigger,
}: {
  options: ListboxOption[]
  value: string | undefined
  onChange: (value: string) => void
  ariaLabel?: string
  labelledBy?: string
  disabled?: boolean
  className?: string
  renderTrigger: (state: {
    open: boolean
    selected: ListboxOption | undefined
    props: Record<string, unknown>
  }) => ReactNode
}) {
  const listId = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const lb = useListbox({
    options,
    disabled,
    initialIndex: () => options.findIndex((o) => o.value === value),
    commit: onChange,
    closeOnCommit: true,
  })

  return (
    <div ref={anchorRef} className={cn('relative', className)}>
      {renderTrigger({
        open: lb.open,
        selected: options.find((o) => o.value === value),
        props: lb.triggerProps(listId, ariaLabel, labelledBy),
      })}
      {lb.open && (
        <ListboxPanel
          id={listId}
          anchorRef={anchorRef}
          options={options}
          value={value}
          onSelect={onChange}
          onClose={lb.close}
          labelledBy={labelledBy}
          activeId={lb.active}
          onActiveChange={lb.setActive}
        />
      )}
    </div>
  )
}

/**
 * `Listbox` for several values. `onToggle` hears which option was ticked or unticked and
 * the caller decides what that does to the selection — see `ui/FilterPill`, which is
 * where "every option ticked is no filter" lives.
 */
export function MultiListbox({
  options,
  values,
  onToggle,
  ariaLabel,
  labelledBy,
  disabled,
  className,
  renderTrigger,
  search,
  onOpenChange,
}: {
  options: ListboxOption[]
  values: readonly string[]
  onToggle: (value: string) => void
  ariaLabel?: string
  labelledBy?: string
  disabled?: boolean
  className?: string
  renderTrigger: (state: { open: boolean; props: Record<string, unknown> }) => ReactNode
  /** A search box at the top of the panel; the caller filters `options` on its value. */
  search?: ListboxSearch
  onOpenChange?: (open: boolean) => void
}) {
  const listId = useId()
  const anchorRef = useRef<HTMLDivElement>(null)
  const lb = useListbox({
    options,
    disabled,
    // Opens on the first ticked row, so the keyboard starts where the selection is.
    initialIndex: () => options.findIndex((o) => values.includes(o.value)),
    commit: onToggle,
    closeOnCommit: false,
    searchable: !!search,
  })

  const wasOpen = useRef(false)
  useEffect(() => {
    onOpenChange?.(lb.open)
    // The search box took focus and has just been unmounted with the panel, which drops
    // focus on <body>. Hand it back to the trigger — unless the close was a click on
    // something else that took focus, which is where the person meant to go.
    if (wasOpen.current && !lb.open && search) {
      const lost = !document.activeElement || document.activeElement === document.body
      if (lost) anchorRef.current?.querySelector<HTMLElement>('[role="combobox"]')?.focus()
    }
    wasOpen.current = lb.open
  }, [lb.open]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new query is a new list: the keyboard starts again from its top.
  useEffect(() => {
    if (lb.open && search) lb.setActive(lb.firstPickable())
  }, [search?.value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={anchorRef} className={cn('relative', className)}>
      {renderTrigger({ open: lb.open, props: lb.triggerProps(listId, ariaLabel, labelledBy) })}
      {lb.open && (
        <ListboxPanel
          id={listId}
          anchorRef={anchorRef}
          options={options}
          selected={values}
          onSelect={onToggle}
          onClose={lb.close}
          labelledBy={labelledBy}
          activeId={lb.active}
          onActiveChange={lb.setActive}
          search={search && { ...search, onKeyDown: lb.onKeyDown }}
        />
      )}
    </div>
  )
}
