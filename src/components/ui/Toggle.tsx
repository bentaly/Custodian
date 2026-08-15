import { C } from './tokens'

/**
 * An on/off setting that takes effect as you flick it — never inside a form with a Save
 * button, which is what a `Checkbox` is for.
 *
 * It lives here because the app had exactly one switch, hand-rolled on the voting
 * settings screen, and it was **charcoal** when on: `bg-grey-900`, the old Tailwind look
 * the whole redesign moved off. On is the brand green now, like every other affirmative
 * control in the app. The second setting that wants a switch would otherwise have copied
 * the first one, charcoal and all.
 *
 * `busy` disables it without pretending nothing happened — the caller flips its own state
 * optimistically and reverts on failure, so the switch tracks the intent, not the request.
 */
export function Toggle({
  checked,
  onChange,
  busy = false,
  label,
  describedBy,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  busy?: boolean
  /** What the switch controls, for anyone who cannot see the text beside it. */
  label: string
  /** Id of the copy explaining the setting, so it is announced with the switch. */
  describedBy?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      disabled={busy}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{ backgroundColor: checked ? C.brand : C.muted }}
    >
      <span
        className="inline-block size-4 rounded-full bg-white transition-transform"
        style={{ transform: `translateX(${checked ? 24 : 4}px)` }}
      />
    </button>
  )
}
