import { Download01Icon } from '@hugeicons/core-free-icons'
import { Button, type ButtonSize } from './Button'
import { Listbox } from './Listbox'
import type { ExportFormat } from '../../lib/spreadsheetExport'

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

// Excel first: it is what a finance officer opens, and the one that keeps an account
// number's leading zero. CSV stays for anything that imports a plain file.
const FORMAT_OPTIONS: { value: ExportFormat; label: string }[] = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
]

/**
 * `ExportButton` for a screen that offers both formats: the same button, opening a
 * choice of file. Built on `Listbox` with no value, like the Applications bulk-status
 * menu: it never shows a state, it picks a format and goes.
 */
export function ExportMenu({
  onExport,
  busy = false,
  disabled = false,
  label = 'Export',
  busyLabel = 'Exporting…',
  size = 'md',
}: {
  onExport: (format: ExportFormat) => void
  busy?: boolean
  disabled?: boolean
  label?: string
  busyLabel?: string
  size?: ButtonSize
}) {
  return (
    <Listbox
      className="shrink-0"
      options={FORMAT_OPTIONS}
      value={undefined}
      onChange={(v) => onExport(v as ExportFormat)}
      ariaLabel="Export format"
      disabled={busy || disabled}
      renderTrigger={({ props }) => (
        <Button {...props} variant="tinted" size={size} icon={Download01Icon} iconPosition="right">
          {busy ? busyLabel : label}
        </Button>
      )}
    />
  )
}
