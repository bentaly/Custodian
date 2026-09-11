import { useBlocker } from '@tanstack/react-router'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * "You have unsaved changes" — for any screen holding edits behind an explicit Save.
 *
 * ## Why a guard and not a disabled control
 *
 * Settings screens save on a button, so between typing and pressing it the only copy of
 * somebody's work is in a text box. Navigation arrives from everywhere — the sidebar, a
 * breadcrumb, a tab, the browser's own back button — so unlike a single control there is
 * nothing to disable. The screen has to ask instead.
 *
 * It arms ONLY while `dirty`, so a screen nobody has touched never interrupts anyone, and
 * the moment a save lands the guard disarms on its own.
 *
 * `enableBeforeUnload` covers the other way out: closing the tab or reloading. The browser
 * shows its own wording there and there is nothing we can do about that, but silence would
 * be worse.
 *
 * ## Say what is at stake
 *
 * `what` names the thing in the user's nouns — "the 2026/27 budget", "your award letter
 * template". A dialog reading "you have unsaved changes, leave or stay?" is one people
 * click through without reading; one that names the year they were editing is not.
 */
export function UnsavedChangesGuard({ dirty, what }: { dirty: boolean; what: string }) {
  const blocker = useBlocker({
    shouldBlockFn: () => dirty,
    withResolver: true,
    enableBeforeUnload: () => dirty,
  })

  return (
    <ConfirmDialog
      open={blocker.status === 'blocked'}
      title="Leave without saving?"
      confirmLabel="Leave without saving"
      onCancel={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
    >
      Your changes to {what} have not been saved. Leaving now discards them.
    </ConfirmDialog>
  )
}
