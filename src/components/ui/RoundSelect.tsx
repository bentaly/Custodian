import { Calendar03Icon } from '@hugeicons/core-free-icons'
import { getRoundStatus } from '../../lib/roundStatus'
import { SelectPill } from './SelectPill'

/**
 * The round selector every round-scoped screen wears: the Figma pill (calendar chip +
 * round name + status) — `SelectPill` at its `md` size, with the round vocabulary
 * bound in so callers pass rounds rather than options.
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
  return (
    <SelectPill
      ariaLabel="Select round"
      icon={Calendar03Icon}
      options={rounds.map((r) => ({ value: r.id, label: r.name }))}
      value={value}
      placeholder="Select round"
      suffix={statusLabel}
      onChange={onChange}
    />
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
