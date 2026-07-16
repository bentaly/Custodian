import { useRef, useState } from 'react'
import { cn } from './cn'

/**
 * Six-digit code entry, drawn as segments of the same meter the dashboard uses for
 * round budgets.
 *
 * One real (transparent) input sits over the boxes rather than six separate fields:
 * paste, iOS/Android one-time-code autofill, and caret behaviour then come from the
 * platform instead of being re-implemented per-key.
 */
export function CodeInput({
  value,
  onChange,
  length = 6,
  label,
  autoFocus,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  length?: number
  label: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  // The box the next digit lands in — the last one once the code is complete.
  const cursor = Math.min(value.length, length - 1)

  return (
    <div className="relative" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={label}
        maxLength={length}
        autoFocus={autoFocus}
        disabled={disabled}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer bg-transparent text-transparent caret-transparent outline-none"
      />
      <div className="flex gap-2" aria-hidden>
        {Array.from({ length }).map((_, i) => {
          const active = focused && i === cursor && !disabled
          return (
            <div
              key={i}
              className={cn(
                'flex h-14 flex-1 items-center justify-center rounded-xl border text-[22px] font-semibold tabular-nums transition-all duration-150',
                // Filled segments light up mint, the way the meter's ticks light up —
                // grey would read as disabled rather than entered.
                value[i]
                  ? 'border-moss-100 bg-moss-100 text-ink'
                  : 'border-hairline bg-canvas text-ink-muted',
                active && 'border-moss-600 bg-white ring-4 ring-moss-100',
                disabled && 'opacity-50',
              )}
            >
              {value[i] ?? ''}
            </div>
          )
        })}
      </div>
    </div>
  )
}
