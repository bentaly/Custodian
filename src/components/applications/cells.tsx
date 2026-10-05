import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  MinusSignCircleIcon,
} from '@hugeicons/core-free-icons'
import { Tooltip } from '../ui'
import { C, bandForScore } from '../ui/tokens'
import { withAlpha } from '../BarMeter'
import type { DueDiligenceStatus } from '../../lib/dueDiligence'

// The AI score and due diligence marks as the Applications table draws them, shared with
// the Partnerships list so the same result reads the same on both screens.

export function AiScoreCell({
  status,
  score,
}: {
  status: string | null | undefined
  score: number | null | undefined
}) {
  const has = status === 'scored' && score != null
  const band = has ? bandForScore(score!) : null
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-[3px] w-10 overflow-hidden rounded-full"
        style={{ backgroundColor: band ? withAlpha(band.fill, 0.25) : C.wash }}
      >
        {band && (
          <div
            className="bar-grow absolute left-0 top-0 h-full rounded-full"
            style={{ width: `${Math.min(100, score!)}%`, backgroundColor: band.fill }}
          />
        )}
      </div>
      {has ? (
        <span className="font-display text-body font-medium" style={{ color: C.ink }}>
          {score}
        </span>
      ) : status === 'queued' ? (
        // Only `queued` says this. `pending` means no score is coming (scoring is
        // not configured), and a row that claims to be "scoring" forever is worse
        // than one that admits it has no score.
        <span className="font-display text-label" style={{ color: C.faint }}>
          Scoring…
        </span>
      ) : status === 'waiting' ? (
        // Held until somebody fills in the amount; the row's status says so.
        <span className="font-display text-label" style={{ color: C.faint }}>
          Waiting
        </span>
      ) : null}
    </div>
  )
}

// A tick means "checked and clear" — so a warning must not wear one. Anything the
// registry checks flagged gets the alert triangle; only `clear` gets the tick.
const DD_ICON: Record<string, { icon: typeof CheckmarkCircle02Icon; colour: string } | null> = {
  clear: { icon: CheckmarkCircle02Icon, colour: C.success },
  warning: { icon: Alert02Icon, colour: C.amber },
  blocked: { icon: Alert02Icon, colour: C.danger },
  review: { icon: CancelCircleIcon, colour: C.faint },
  // Its own mark, not review's: nothing was attempted and nothing can be. Muted, because
  // an applicant holding neither number is ordinary — it is a fact about the submission,
  // not a flag against the organisation.
  no_registration: { icon: MinusSignCircleIcon, colour: C.faint },
  pending: null,
}

/**
 * A column of bare marks with no legend, so each one has to say what it means where it
 * is. Every status carries a name (the tooltip's accessible name, which is what a
 * screen reader reads for the cell) and a sentence saying what it means and what the
 * mark asks of you — six statuses share five glyphs across three colours, and "amber
 * triangle" is not self-evident.
 */
const DD_MEANING: Record<string, { name: string; detail: string }> = {
  clear: {
    name: 'Due diligence clear',
    detail: 'Every registry check passed.',
  },
  warning: {
    name: 'Due diligence warnings',
    detail: 'Some checks flagged something worth being aware of.',
  },
  blocked: {
    name: 'Due diligence blocked',
    detail: 'A check failed in a way that should stop a grant.',
  },
  review: {
    name: 'Due diligence needs a manual check',
    detail: 'The registers could not answer, please manually check.',
  },
  no_registration: {
    name: 'Not screened (no registration number)',
    // No instruction: adding a number is admin-only (`rerunDueDiligence`), and this
    // column is read by trustees too. Say what is true for everyone; the application
    // screen offers the fix to the people who have it.
    detail: 'No charity or company number was captured, so there is no register to check against.',
  },
  pending: {
    name: 'Not screened yet',
    detail: 'Screening has not run for this application.',
  },
}

// A `title` attribute would be the cheap version of this and is not good enough: it is
// unreachable by touch, appears after a delay nobody controls, and most screen readers
// ignore it. `Tooltip` is a real focusable button with `aria-describedby`, so the
// explanation reaches a keyboard and a screen reader too.
export function DueDiligenceCell({ status }: { status: DueDiligenceStatus }) {
  const d = DD_ICON[status]
  const meaning = DD_MEANING[status] ?? DD_MEANING.pending!
  return (
    <div className="flex justify-center">
      <Tooltip
        label={meaning.name}
        triggerClassName="flex rounded-full focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
        trigger={
          d ? (
            <HugeiconsIcon icon={d.icon} size={20} color={d.colour} />
          ) : (
            <span className="block size-5 rounded-full border" style={{ borderColor: C.line }} />
          )
        }
      >
        <span className="block font-medium text-grey-900">{meaning.name}</span>
        <span className="mt-0.5 block">{meaning.detail}</span>
      </Tooltip>
    </div>
  )
}
