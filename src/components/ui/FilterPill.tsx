import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'

// The filter pill every list/analysis screen shares (Figma 393:29540): a 32px
// bordered chip showing either the label ("Programme") or the chosen value, with
// a native <select> laid transparently over it so the OS picker — and keyboard
// support — come for free.
//
// A pill holding a value goes brand-tinted: with several pills in a row, "which
// filters are on" has to be readable at a glance, not by reading each label.

const C = {
  ink: '#141C24', // Gray/900
  sub: '#637083', // Gray/500
  line: '#E4E7EC', // Gray/200
  brand: '#1F7A5C',
  brandBg: 'rgba(31, 122, 92, 0.1)',
}

export function FilterPill({
  label,
  value,
  options,
  onChange,
  clearLabel,
}: {
  /** Shown when nothing is selected. */
  label: string
  value: string | undefined
  options: Array<{ value: string; label: string }>
  onChange: (v: string | undefined) => void
  /** The select's "no filter" option; defaults to `All <label>`. */
  clearLabel?: string
}) {
  const current = options.find((o) => o.value === value)
  return (
    <div className="relative shrink-0">
      <div
        className="flex h-8 items-center gap-1 rounded-lg border py-2 pl-2 pr-1.5"
        style={{
          borderColor: current ? C.brand : C.line,
          backgroundColor: current ? C.brandBg : '#fff',
        }}
      >
        <span
          className="whitespace-nowrap font-display text-[14px] font-medium"
          style={{ color: current ? C.brand : C.ink }}
        >
          {current ? current.label : label}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={current ? C.brand : C.sub} />
      </div>
      <select
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        <option value="">{clearLabel ?? `All ${label.toLowerCase()}`}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
