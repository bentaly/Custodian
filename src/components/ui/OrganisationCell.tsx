import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Upload01Icon } from '@hugeicons/core-free-icons'
import { initials } from './Avatar'
import { TruncatedText } from './TruncatedText'
import { Tooltip } from './Tooltip'
import { C } from './tokens'
import { cn } from './cn'
import { summaryPreview } from '../../lib/organisationSummary'

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
 *
 * **Hovering the name says who they are** where there is a `summary`: the applicant's
 * own description, else the register's (`server/organisationSummary`). That tooltip
 * names the organisation in full above the description, so it takes over from
 * `TruncatedText`'s rather than sitting inside it: two tooltips on one name would open
 * together. Without a summary (an imported grant, a form that never asked) the name
 * behaves exactly as before.
 */
export function OrganisationCell({
  name,
  subline,
  imported = false,
  summary,
  wrapName,
}: {
  name: string
  /** The identifying line beneath. Falls back to `--` when there is nothing to say. */
  subline?: string | null
  imported?: boolean
  /** Who the organisation is, for the tooltip on its name. Cut down for display here. */
  summary?: string | null
  /**
   * Wraps the name in this screen's link, where it has one. Given the class the name
   * expects so a caller cannot accidentally drop the truncation. Finance has no link:
   * its rows open a payment dialog, so the whole row is the target.
   */
  wrapName?: (content: ReactNode, className: string) => ReactNode
}) {
  const nameClass = 'block min-w-0 font-display text-body font-medium'
  const about = summaryPreview(summary)
  const label = about ? (
    <span className={cn(nameClass, 'truncate')}>{name}</span>
  ) : (
    <TruncatedText text={name} label="Organisation" className={nameClass} />
  )
  const named = wrapName ? wrapName(label, nameClass) : label

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
        {about ? (
          // A link already takes focus and names itself; only a bare name needs the
          // focusable wrapper.
          <AboutOrganisation name={name} summary={about} control={!!wrapName}>
            {named}
          </AboutOrganisation>
        ) : (
          named
        )}
        <TruncatedText
          text={subline || '--'}
          label="Reference"
          className="font-display text-label"
        />
      </div>
    </div>
  )
}

/**
 * The name's tooltip on its own, for a screen that names a grantee without the list
 * cell (the shortlist's vote card). Renders `children` untouched when there is nothing
 * to say about them.
 */
export function AboutOrganisation({
  name,
  summary,
  control = false,
  children,
}: {
  name: string
  summary: string | null | undefined
  /** `children` is a link or button, which keeps its own tab stop. See `Tooltip`. */
  control?: boolean
  children: ReactNode
}) {
  const about = summaryPreview(summary)
  if (!about) return <>{children}</>
  return (
    <Tooltip
      label={`About ${name}`}
      control={control}
      trigger={children}
      className="block min-w-0"
      triggerClassName="block min-w-0 w-full cursor-default rounded-chip focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:outline-hidden"
      maxWidth={320}
    >
      <span className="block font-medium text-grey-900">{name}</span>
      <span className="mt-0.5 block">{about}</span>
    </Tooltip>
  )
}
