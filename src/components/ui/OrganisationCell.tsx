import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Upload01Icon } from '@hugeicons/core-free-icons'
import { initials } from './Avatar'
import { TruncatedText } from './TruncatedText'
import { Tooltip } from './Tooltip'
import { C } from './tokens'

/**
 * The grantee, as every list screen names one: a monogram, the organisation, and one
 * line of identifying facts beneath it.
 *
 * It exists because three screens had grown their own copy. Applications and Awards
 * carried the monogram; Finance did not, so the same charity read as a different KIND
 * of thing depending on which screen you were on, and the eye lost the anchor it uses
 * to scan a column of names. Reports is the fourth caller.
 *
 * **The imported mark sits on the monogram, not beside the name.** As a pill next to
 * the organisation it took room from the thing people actually read, and once the word
 * was dropped at a foundation's request the bare chip read as a button. On the corner
 * of the square it is provenance attached to the grantee, which is what it is, and the
 * name gets the full width back.
 *
 * Truncation is `TruncatedText`, so a clipped name hands the rest over on hover instead
 * of ending in an ellipsis that leads nowhere. The name was plain `truncate` on all
 * three screens: a long charity name simply stopped, with no way to read the end of it.
 */
export function OrganisationCell({
  name,
  subline,
  imported = false,
  wrapName,
}: {
  name: string
  /** The identifying line beneath. Falls back to `--` when there is nothing to say. */
  subline?: string | null
  imported?: boolean
  /**
   * Wraps the name in this screen's link, where it has one. Given the class the name
   * expects so a caller cannot accidentally drop the truncation. Finance has no link:
   * its rows open a payment dialog, so the whole row is the target.
   */
  wrapName?: (content: ReactNode, className: string) => ReactNode
}) {
  const nameClass = 'block min-w-0 font-display text-body font-medium'
  const label = <TruncatedText text={name} label="Organisation" className={nameClass} />

  return (
    <div className="flex items-center gap-2">
      <div className="relative shrink-0">
        <div
          className="flex size-10 items-center justify-center rounded-chip"
          style={{ backgroundColor: C.wash }}
        >
          <span className="font-display text-body font-semibold" style={{ color: C.ink }}>
            {initials(name)}
          </span>
        </div>
        {imported && (
          // Half off the corner, so it reads as a mark ON the monogram rather than a
          // second control beside it. The white ring is the table's own background:
          // without it the glyph merges into the square at this size.
          <Tooltip
            label="Imported"
            className="absolute -right-1 -bottom-1"
            triggerClassName="flex rounded-full focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
            trigger={
              <span
                className="flex size-4 items-center justify-center rounded-full ring-2 ring-white"
                style={{ backgroundColor: C.infoWash, color: C.info }}
              >
                <HugeiconsIcon icon={Upload01Icon} size={10} color="currentColor" />
              </span>
            }
          >
            <span className="block font-medium text-grey-900">Imported</span>
            <span className="mt-0.5 block">
              Brought in from your existing records, so it has no application form, score, due
              diligence or votes behind it.
            </span>
          </Tooltip>
        )}
      </div>
      <div className="min-w-0">
        {wrapName ? wrapName(label, nameClass) : label}
        <TruncatedText
          text={subline || '--'}
          label="Reference"
          className="font-display text-label"
        />
      </div>
    </div>
  )
}
