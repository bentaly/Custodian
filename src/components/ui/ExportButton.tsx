import { Download01Icon } from '@hugeicons/core-free-icons'
import { Button } from './Button'

// The app's export affordance — `Button`'s `tinted` variant with the download arrow,
// kept as its own component so every screen's export says the same thing in the same
// place, and so "exporting…" is never re-invented per screen.

export function ExportButton({
  onClick,
  busy = false,
  disabled = false,
  label = 'Export CSV',
  busyLabel = 'Exporting…',
}: {
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  label?: string
  busyLabel?: string
}) {
  return (
    <Button
      variant="tinted"
      icon={Download01Icon}
      iconPosition="right"
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? busyLabel : label}
    </Button>
  )
}
