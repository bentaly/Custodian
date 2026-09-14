import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkSquare02Icon, SquareIcon } from '@hugeicons/core-free-icons'
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

export type ListboxOption = { value: string; label: string; disabled?: boolean }

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
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const pos = useAnchoredPopover(true, anchorRef, panelRef, true)
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
      className="fixed z-[60] max-h-72 overflow-y-auto rounded-control p-1.5 shadow-[0px_11px_24px_rgba(0,0,0,0.1),0px_43px_43px_rgba(0,0,0,0.09)]"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        minWidth: pos?.width,
        backgroundColor: C.wash,
        // Hidden until placed, so it never paints for a frame in the top-left corner.
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {options.length === 0 && (
        <p className={cn(ROW, 'justify-center')} style={{ color: C.sub }}>
          Nothing to choose from
        </p>
      )}
      {options.map((o, i) => {
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
            className={cn(ROW, o.disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
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
            <span className="truncate">{o.label}</span>
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
}: {
  options: ListboxOption[]
  disabled?: boolean
  initialIndex: () => number
  commit: (value: string) => void
  closeOnCommit: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = useRef({ term: '', at: 0 })

  const step = (from: number, dir: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const n = (from + dir * i + options.length * 2) % options.length
      if (!options[n]?.disabled) return n
    }
    return from
  }

  function openAt() {
    const at = initialIndex()
    setActive(at >= 0 ? at : options.findIndex((o) => !o.disabled))
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
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(step(-1, 1))
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(step(0, -1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const o = options[active]
      if (o && !o.disabled) commit(o.value)
      if (closeOnCommit) setOpen(false)
    } else if (e.key === 'Tab') {
      setOpen(false)
    } else if (e.key.length === 1) {
      // Typeahead: keystrokes within a second build a prefix, so "co" reaches
      // "Community & Place" rather than cycling the two options starting with C.
      const now = Date.now()
      typed.current = {
        term: (now - typed.current.at < 1000 ? typed.current.term : '') + e.key.toLowerCase(),
        at: now,
      }
      const hit = options.findIndex(
        (o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.term),
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

  return { open, close: () => setOpen(false), active, setActive, triggerProps }
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
}: {
  options: ListboxOption[]
  values: readonly string[]
  onToggle: (value: string) => void
  ariaLabel?: string
  labelledBy?: string
  disabled?: boolean
  className?: string
  renderTrigger: (state: { open: boolean; props: Record<string, unknown> }) => ReactNode
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
  })

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
        />
      )}
    </div>
  )
}
