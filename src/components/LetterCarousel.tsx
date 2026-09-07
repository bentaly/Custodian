import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { AwardLetterPreview } from './AwardLetterPreview'
import { Button } from './ui'
import { C } from './ui/tokens'

/**
 * One letter at a time, paged with ‹ ›.
 *
 * Stacked, a batch of eight letters is several thousand words of near-identical text in
 * one scroll — which is not a preview anybody reads. Paging keeps each letter whole and
 * makes it obvious how many there are.
 *
 * Shared by award set-up and the decline dialog. Both are "here is what these
 * organisations are about to be sent, look before you commit", and the control was
 * lifted here the moment there were two of them rather than copied — a preview that
 * behaves differently on the two screens is a preview one of them stops being trusted on.
 */
export function LetterCarousel<T>({
  items,
  index,
  onIndex,
  labelFor,
  letterFor,
  /** Rendered under the label, e.g. the address a letter is going to. */
  metaFor,
}: {
  items: T[]
  index: number
  onIndex: (i: number) => void
  labelFor: (item: T) => string
  letterFor: (item: T) => { subject: string; bodyText: string }
  metaFor?: (item: T) => string | null
}) {
  const item = items[index]
  if (!item) return null
  const letter = letterFor(item)
  const meta = metaFor?.(item) ?? null

  return (
    <div className="border-t" style={{ borderColor: C.line }}>
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5"
        style={{ backgroundColor: C.wash }}
      >
        <div className="min-w-0">
          <span
            className="block truncate font-display text-body font-medium"
            style={{ color: C.ink }}
          >
            {labelFor(item)}
          </span>
          {meta && (
            <span className="block truncate font-display text-label" style={{ color: C.sub }}>
              {meta}
            </span>
          )}
        </div>
        {items.length > 1 && (
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              icon={ArrowLeft01Icon}
              aria-label="Previous letter"
              onClick={() => onIndex(index - 1)}
              disabled={index === 0}
            />
            <span className="font-display text-label tabular-nums" style={{ color: C.sub }}>
              {index + 1} of {items.length}
            </span>
            <Button
              variant="secondary"
              size="xs"
              icon={ArrowRight01Icon}
              aria-label="Next letter"
              onClick={() => onIndex(index + 1)}
              disabled={index === items.length - 1}
            />
          </div>
        )}
      </div>
      <div className="px-4 py-4">
        <div className="mb-2 font-display text-label" style={{ color: C.faint }}>
          Subject: <span style={{ color: C.body }}>{letter.subject}</span>
        </div>
        <AwardLetterPreview bodyText={letter.bodyText} />
      </div>
    </div>
  )
}
