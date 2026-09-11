import { useState, type ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { Button } from './Button'
import doneIcon from '../icons/step-done.svg'
import currentIcon from '../icons/step-current.svg'
import futureIcon from '../icons/step-future.svg'
import { C } from './tokens'

// A vertical line of dated steps (Figma 1190:6537 / 1190:6504) — the report screen's
// grant timeline. Three markers, and they are about where the grant IS
// rather than about emphasis: `done` is behind it, `current` is the one thing it is
// waiting on next, `future` is the rest.
//
// Long schedules are windowed rather than drawn in full: a three-year grant reporting
// quarterly is twelve steps, and a side-column card that tall pushes everything under it
// off the screen. The window is centred on the step that matters (`anchor`), because the
// first five steps of a grant in its third year are the five least worth reading.

export type TimelineMarker = 'done' | 'current' | 'future'

export type TimelineStep = {
  key: string
  title: ReactNode
  sub: ReactNode
  /** The sub line in danger — a date that has passed with nothing to show for it. */
  urgent?: boolean
  marker: TimelineMarker
  /** Where the title goes, if the step has a page of its own. */
  link?: Pick<LinkProps, 'to' | 'params' | 'search'>
}

/** How many steps show before the rest fold away. */
const WINDOW = 5

/** The design's own three step icons, exported from Figma as they are. Decorative to a
 *  screen reader: every step's line already says Paid, Received or Due in words. */
const MARKER_ICON: Record<TimelineMarker, string> = {
  done: doneIcon,
  current: currentIcon,
  future: futureIcon,
}

function Marker({ kind }: { kind: TimelineMarker }) {
  return <img src={MARKER_ICON[kind]} alt="" className="size-4 shrink-0" />
}

export function Timeline({
  steps,
  anchor = 0,
}: {
  steps: TimelineStep[]
  /** Index of the step the folded view is centred on. */
  anchor?: number
}) {
  const [open, setOpen] = useState(false)
  const folds = steps.length > WINDOW + 1
  const start = folds
    ? Math.min(Math.max(anchor - Math.floor(WINDOW / 2), 0), steps.length - WINDOW)
    : 0
  const shown = folds && !open ? steps.slice(start, start + WINDOW) : steps
  const hiddenBefore = folds && !open ? start : 0
  const hiddenAfter = folds && !open ? steps.length - start - WINDOW : 0

  return (
    <div className="flex flex-col gap-3">
      {hiddenBefore > 0 && <Folded count={hiddenBefore} when="earlier" />}
      <ol className="flex flex-col gap-6">
        {shown.map((step, i) => (
          <li key={step.key} className="relative flex items-start gap-2">
            {/* The rule joining this marker to the next: from under the marker, through
                the 24px gap, to the top of the next one. Omitted after the last. */}
            {i < shown.length - 1 && (
              <span
                aria-hidden
                className="absolute top-4 -bottom-6 left-[7.5px] w-px"
                style={{ backgroundColor: C.line }}
              />
            )}
            <Marker kind={step.marker} />
            <div className="flex min-w-0 flex-col gap-1 font-display text-body leading-tight">
              {step.link ? (
                <Link
                  {...step.link}
                  className="font-medium hover:underline"
                  style={{ color: C.ink }}
                >
                  {step.title}
                </Link>
              ) : (
                <span className="font-medium" style={{ color: C.ink }}>
                  {step.title}
                </span>
              )}
              <span
                style={{
                  color: step.urgent ? C.danger : C.sub,
                  fontWeight: step.urgent ? 500 : undefined,
                }}
              >
                {step.sub}
              </span>
            </div>
          </li>
        ))}
      </ol>
      {hiddenAfter > 0 && <Folded count={hiddenAfter} when="later" />}
      {folds && (
        <Button
          variant="text"
          size="xs"
          className="self-start"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Show fewer' : `Show all ${steps.length}`}
        </Button>
      )}
    </div>
  )
}

/** A quiet line standing in for steps folded out of the window, so the line visibly
 *  carries on rather than appearing to start or stop where the window does. */
function Folded({ count, when }: { count: number; when: 'earlier' | 'later' }) {
  return (
    <p className="pl-6 font-display text-label" style={{ color: C.faint }}>
      {count} {when}
    </p>
  )
}
