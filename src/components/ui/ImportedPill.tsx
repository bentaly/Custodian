import { HugeiconsIcon } from '@hugeicons/react'
import { Upload01Icon } from '@hugeicons/core-free-icons'
import { Badge } from './Badge'
import { C } from './tokens'
import { cn } from './cn'

/**
 * "This row came in through Settings → Data import, not through Custodian."
 *
 * A foundation's onboarding import brings its back catalogue in as ordinary
 * applications, grants and payments — deliberately without the things Custodian would
 * have produced itself (an application form, a Custodian score, due diligence, trustee
 * votes). Without a mark on the row those blanks read as data we LOST rather than as
 * history that predates us, which is the reason `import_batch_id` is kept permanently
 * on the row in the first place.
 *
 * It is provenance, not status, so it wears `info` — a hue no status pill in the app
 * uses — and the `sm` size: it annotates the name it sits beside rather than competing
 * with it (see `Badge`). The glyph is a plain upload arrow rather than Settings' own
 * database-import mark: at 11px the database drum closes up into a smudge, and what the
 * row is saying is "this came from you", not which screen it came through.
 *
 * **The glyph carries it alone**, without the word, at a foundation's request: the mark
 * sits next to an organisation name in a narrow column and "Imported" was taking room
 * from the thing people are actually reading. The word has not gone anywhere a screen
 * reader is concerned — it is the accessible name — and hovering still explains what
 * the blanks on the row mean, which is the whole reason the mark exists.
 */
export function ImportedPill({ className }: { className?: string }) {
  return (
    <Badge
      size="sm"
      className={cn('shrink-0 items-center', className)}
      style={{ backgroundColor: C.infoWash, color: C.info }}
      title="Imported from your existing records, so it has no application form, score or votes."
      aria-label="Imported"
    >
      <HugeiconsIcon icon={Upload01Icon} size={11} color="currentColor" />
    </Badge>
  )
}
