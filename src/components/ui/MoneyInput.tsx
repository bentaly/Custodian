import { Input } from './fields'
import { C } from './tokens'

/**
 * A pounds field: the sign is chrome, not something anybody types.
 *
 * Lifted out of `RoundDialog`, which owned the only copy, when the annual budget screen
 * needed the same field — a round's budget and a year's budget are the same kind of
 * input and must not drift into two.
 *
 * `type="number"` so a phone offers a numeric keypad and the browser rejects letters;
 * `step="0.01"` because a budget is captured to the penny even though it is almost
 * always round. The value stays a STRING all the way to the submit handler: an empty
 * field is `''`, which is a different thing from `0`, and parsing early loses that.
 */
export function MoneyInput({
  value,
  label,
  placeholder = 'Amount',
  required,
  disabled,
  onChange,
  className,
  id,
}: {
  value: string
  /** Accessible name — these sit in rows where the visible label is a column header. */
  label: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  onChange: (value: string) => void
  className?: string
  id?: string
}) {
  return (
    <div className={`relative ${className ?? ''}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-display text-body font-medium"
        style={{ color: C.brand }}
      >
        £
      </span>
      <Input
        id={id}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="pl-7"
      />
    </div>
  )
}
