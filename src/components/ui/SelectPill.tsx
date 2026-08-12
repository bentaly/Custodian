import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'
import { Listbox, type ListboxOption } from './Listbox'

// The dropdown pill the round-scoped screens wear (Figma 184:13784 / 400:30227): a
// bordered chip that opens the app's own `Listbox` panel. It used to lay a transparent
// native <select> over the chip, which bought keyboard and mobile pickers for free but
// left the open panel looking like whatever the browser felt like — the one part of the
// control the design has an opinion about.
//
// Two sizes, because the same control does two jobs on one screen. `md` is the
// screen-level selector that sits beside the <h1> — 40px, with a leading icon chip.
// `sm` is the in-card selector — 32px, no chip, a label prefix — so it reads as "one of
// the card's controls" rather than competing with the round pill above it.
//
// Both wear Gray/900 text and a Gray/900 caret, as every dropdown in the app does. The
// green is reserved for the icon chip, which marks *what kind* of selector this is.

type IconElement = Parameters<typeof HugeiconsIcon>[0]['icon']

export type SelectPillOption = ListboxOption

export function SelectPill({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  icon,
  label,
  suffix,
  placeholder,
  clearLabel,
}: {
  options: SelectPillOption[]
  value: string | undefined
  /** `''` when the clear option is picked (only offered when `clearLabel` is set). */
  onChange: (value: string) => void
  ariaLabel: string
  size?: 'sm' | 'md'
  /** Leading icon chip — `md` only. */
  icon?: IconElement
  /** Prefix shown before the value, e.g. `Programme` → "Programme: Youth work". */
  label?: string
  /** Trailing dimmed note, e.g. "Current round". */
  suffix?: string | null
  /** Shown when nothing matches `value`. */
  placeholder?: string
  /** Offers a "no selection" option with this label; omit for a required choice. */
  clearLabel?: string
}) {
  const sm = size === 'sm'
  const all = clearLabel !== undefined ? [{ value: '', label: clearLabel }, ...options] : options

  return (
    <Listbox
      className="shrink-0"
      options={all}
      value={value ?? ''}
      onChange={onChange}
      ariaLabel={ariaLabel}
      renderTrigger={({ open, selected, props }) => (
        <button
          {...props}
          className={
            sm
              ? 'flex h-8 items-center gap-1 rounded-chip border bg-white pl-2 pr-1.5 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden'
              : 'flex h-10 items-center gap-2 rounded-control border bg-white py-1 pl-1 pr-3 focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden'
          }
          style={{ borderColor: open ? C.brand : C.line }}
        >
          {!sm && icon && (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-chip"
              style={{ backgroundColor: C.wash }}
            >
              <HugeiconsIcon icon={icon} size={16} color={C.brand} />
            </span>
          )}
          {label && (
            <span
              className="whitespace-nowrap font-display text-body font-medium"
              style={{ color: C.ink }}
            >
              {label}:
            </span>
          )}
          <span
            className={`whitespace-nowrap font-display text-body ${sm ? '' : 'font-medium'}`}
            style={{ color: C.ink }}
          >
            {selected?.label ?? placeholder ?? clearLabel ?? '—'}
          </span>
          {suffix && (
            <span
              className="whitespace-nowrap font-display text-label font-medium"
              style={{ color: C.faint }}
            >
              · {suffix}
            </span>
          )}
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.ink} />
        </button>
      )}
    />
  )
}
