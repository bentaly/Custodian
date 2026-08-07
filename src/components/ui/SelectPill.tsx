import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { C } from './tokens'

// The dropdown pill the round-scoped screens wear (Figma 184:13784 / 400:30227): a
// bordered chip with a native <select> laid transparently over it, so keyboard and
// mobile pickers come free.
//
// Two sizes, because the same control does two jobs on one screen. `md` is the
// screen-level selector that sits beside the <h1> — 40px, with a leading icon chip.
// `sm` is the in-card selector — 32px, no chip, a label prefix — so it reads as "one of
// the card's controls" rather than competing with the round pill above it.
//
// Both wear Gray/900 text and a Gray/900 caret, as every dropdown in the app does. The
// green is reserved for the icon chip, which marks *what kind* of selector this is.

type IconElement = Parameters<typeof HugeiconsIcon>[0]['icon']

export type SelectPillOption = { value: string; label: string }

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
  const current = options.find((o) => o.value === value)
  const sm = size === 'sm'
  return (
    <div className="relative shrink-0">
      <div
        className={
          sm
            ? 'flex h-8 items-center gap-1 rounded-lg border bg-white pl-2 pr-1.5'
            : 'flex h-10 items-center gap-2 rounded-[12px] border bg-white py-1 pl-1 pr-3'
        }
        style={{ borderColor: C.line }}
      >
        {!sm && icon && (
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: C.wash }}
          >
            <HugeiconsIcon icon={icon} size={16} color={C.brand} />
          </div>
        )}
        {label && (
          <span
            className="whitespace-nowrap font-display text-[14px] font-medium"
            style={{ color: C.ink }}
          >
            {label}:
          </span>
        )}
        <span
          className={`whitespace-nowrap font-display text-[14px] ${sm ? '' : 'font-medium'}`}
          style={{ color: C.ink }}
        >
          {current?.label ?? placeholder ?? clearLabel ?? '—'}
        </span>
        {suffix && (
          <span
            className="whitespace-nowrap font-display text-[12px] font-medium"
            style={{ color: C.faint }}
          >
            · {suffix}
          </span>
        )}
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.ink} />
      </div>
      <select
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        {clearLabel !== undefined && <option value="">{clearLabel}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
