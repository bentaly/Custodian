import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Calendar03Icon } from '@hugeicons/core-free-icons'
import { getRoundStatus } from '../../lib/roundStatus'

// Design tokens (Figma variables — pinned until the token set lands), matching the
// other header chrome.
const C = {
  sub: '#637083',
  faint: '#97A1AF',
  line: '#E4E7EC',
  wash: '#F2F4F7',
  brand: '#1F7A5C',
}

/**
 * The round selector every round-scoped screen wears: the Figma pill (calendar chip +
 * round name + status), with a real native `<select>` laid transparently over it so
 * keyboard and mobile behaviour come free.
 *
 * There is deliberately **no "all rounds" option**. Every screen that uses this is
 * about one round's decisions — spend against a round's budget, a board's votes at one
 * sitting — and totals summed across rounds would be meaningless rather than merely
 * broad. Callers default the selection to the most recent round instead.
 */
export function RoundSelect({
  rounds,
  value,
  statusLabel,
  onChange,
}: {
  rounds: Array<{ id: string; name: string }>
  value: string | undefined
  statusLabel?: string | null
  onChange: (roundId: string) => void
}) {
  const current = rounds.find((r) => r.id === value)
  return (
    <div className="relative shrink-0">
      <div
        className="flex items-center gap-2 rounded-[12px] border bg-white py-1 pl-1 pr-3"
        style={{ borderColor: C.line }}
      >
        <div
          className="flex size-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: C.wash }}
        >
          <HugeiconsIcon icon={Calendar03Icon} size={16} color={C.brand} />
        </div>
        <span
          className="whitespace-nowrap font-display text-[14px] font-medium"
          style={{ color: C.brand }}
        >
          {current?.name ?? 'Select round'}
        </span>
        {statusLabel && (
          <span
            className="whitespace-nowrap font-display text-[12px] font-medium"
            style={{ color: C.faint }}
          >
            · {statusLabel}
          </span>
        )}
        <HugeiconsIcon icon={ArrowDown01Icon} size={16} color={C.sub} />
      </div>
      <select
        aria-label="Select round"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full cursor-pointer opacity-0"
      >
        {rounds.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/** The status suffix shown beside the round name in the pill. */
export function roundStatusLabel(
  round: Parameters<typeof getRoundStatus>[0] | undefined,
): string | null {
  if (!round) return null
  const status = getRoundStatus(round)
  return status === 'open' ? 'Current round' : status === 'closed' ? 'Closed' : null
}
