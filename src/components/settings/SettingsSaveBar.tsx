import { Button, ErrorNote } from '../ui'
import { C } from '../ui/tokens'

/**
 * The save bar a Settings form pins to the bottom of the screen.
 *
 * It is the one control on a long form you always need to reach, so it follows you down
 * a 400-line letter template. Two things about it are easy to get wrong and are fixed
 * here once rather than per screen:
 *
 * **It is opaque.** It was `bg-white/95` with a backdrop blur, which on a white page
 * reads as a floating button with the form showing faintly through it — a bar you can
 * see through does not look pinned, it looks broken.
 *
 * **It covers the scroll container's own padding.** `<main>` (in `_authenticated.tsx`)
 * is the scrollport and carries `p-4`, and a sticky `bottom-0` sticks to the bottom of
 * its CONTENT box — so 16px of the page kept scrolling past underneath the bar, which is
 * exactly the gap that made it look like it was hovering. `-bottom-4` drops it by that
 * padding so it sits flush on the window edge, and the extra bottom padding puts the
 * button back where the eye expects it. `-mx-4` does the same job horizontally.
 *
 * The two are coupled to `<main>`'s padding on purpose and in one place: the alternative
 * is every settings screen discovering the gap for itself.
 */
export function SettingsSaveBar({
  onSave,
  saving,
  saved,
  dirty,
  error,
}: {
  onSave: () => void
  saving: boolean
  saved: boolean
  dirty: boolean
  error: string
}) {
  return (
    <div
      className="sticky -bottom-4 z-10 -mx-4 flex items-center gap-3 border-t bg-white px-4 pb-7 pt-3"
      style={{ borderColor: C.line }}
    >
      <Button onClick={onSave} disabled={saving || !dirty}>
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </Button>
      {dirty && !saving && (
        <span className="font-display text-label" style={{ color: C.sub }}>
          Unsaved changes
        </span>
      )}
      <ErrorNote error={error} />
    </div>
  )
}
