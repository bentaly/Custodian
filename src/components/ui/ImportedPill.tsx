import { HugeiconsIcon } from '@hugeicons/react'
import { DatabaseImportIcon } from '@hugeicons/core-free-icons'
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
 * with it (see `Badge`). The glyph is the one Settings uses for the import itself.
 */
export function ImportedPill({ className }: { className?: string }) {
  return (
    <Badge
      size="sm"
      className={cn('shrink-0 items-center gap-1', className)}
      style={{ backgroundColor: C.infoWash, color: C.info }}
      title="Imported from your existing records — it has no application form, score or votes."
    >
      <HugeiconsIcon icon={DatabaseImportIcon} size={11} color="currentColor" />
      Imported
    </Badge>
  )
}
