import { HugeiconsIcon } from '@hugeicons/react'
import { Download01Icon } from '@hugeicons/core-free-icons'

// The app's export affordance — the brand-tinted 40px button from the Applications
// list. Kept as its own component so every screen's export looks identical.

const BRAND = '#1F7A5C'
const BRAND_BG = 'rgba(31, 122, 92, 0.1)'
const BRAND_BORDER = 'rgba(31, 122, 92, 0.2)'

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
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="flex h-10 items-center gap-2 rounded-[12px] border px-3 disabled:opacity-60"
      style={{ backgroundColor: BRAND_BG, borderColor: BRAND_BORDER }}
    >
      <span className="font-display text-[14px] font-medium" style={{ color: BRAND }}>
        {busy ? busyLabel : label}
      </span>
      <HugeiconsIcon icon={Download01Icon} size={18} color={BRAND} />
    </button>
  )
}
