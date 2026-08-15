import { fmtDate, fmtDateTime, isoValue } from '../../lib/format'

/**
 * A date on screen: `5 Mar 2026`, with the exact time on hover where there is one.
 *
 * `<time>` rather than a bare span, so the machine-readable value travels with the
 * human one. And a `title` rather than the app's `Tooltip` component, which is a
 * deliberate exception to the rule written on that component: `title` is unreachable by
 * touch and slow to appear, which disqualifies it for anything a reader NEEDS — but
 * here the date is already on screen and the time is a refinement. Wrapping every cell
 * of a 25-row table in a focusable portalled bubble would be a lot of machinery for a
 * detail nobody is looking for.
 *
 * A calendar date (`yyyy-mm-dd`) gets no title at all: there is no time to show.
 */
export function DateText({
  value,
  className,
}: {
  value: Date | string | null | undefined
  className?: string
}) {
  if (!value) return <span className={className}>—</span>
  const exact = fmtDateTime(value)
  return (
    <time dateTime={isoValue(value)} title={exact ?? undefined} className={className}>
      {fmtDate(value)}
    </time>
  )
}
