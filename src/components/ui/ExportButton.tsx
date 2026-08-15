import { Download01Icon } from '@hugeicons/core-free-icons'
import { Button, type ButtonSize } from './Button'

// The app's export affordance — `Button`'s `tinted` variant with the download arrow,
// kept as its own component so every screen's export says the same thing in the same
// place, and so "exporting…" is never re-invented per screen.

export function ExportButton({
  onClick,
  busy = false,
  disabled = false,
  label = 'Export CSV',
  busyLabel = 'Exporting…',
  size = 'md',
}: {
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  label?: string
  busyLabel?: string
  /**
   * 40px by default — an export is a screen-level action. Drop to `sm` where it sits
   * beside a 32px control (a `Tabs` track), so the pair share a height instead of the
   * export looming over it.
   */
  size?: ButtonSize
}) {
  return (
    <Button
      variant="tinted"
      size={size}
      icon={Download01Icon}
      iconPosition="right"
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? busyLabel : label}
    </Button>
  )
}
