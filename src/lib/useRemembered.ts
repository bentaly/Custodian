import { useCallback, useSyncExternalStore } from 'react'

/**
 * A collapse/expand state that survives a reload — "leave the raw submission open and
 * it is open tomorrow".
 *
 * ## Why `useSyncExternalStore` and not `useState` + an effect
 *
 * These routes are server-rendered, so reading `localStorage` in the initial render is
 * a hydration mismatch: the server had no storage and rendered the default. This hook
 * hands React a server snapshot of "nothing stored" — so SSR and the hydrating render
 * agree on the default — and React re-reads immediately afterwards on the client.
 *
 * The cost is one frame of the default on a HARD RELOAD (in-app navigation never
 * remounts the document, so it does not apply there). A panel that defaults closed
 * expands into place, which reads as the disclosure animation it already is. Removing
 * that frame entirely needs a blocking script in `__root`'s `<head>` stamping the
 * `<html>` element before first paint, with CSS doing the hiding — worth it for
 * something the size of a sidebar, not for a card.
 *
 * ## What NOT to wire to this
 *
 * **Popovers, menus and dialogs.** `ActionMenu`, `Listbox`, `DateField` and the vote
 * popover in `VoteCard` all carry `aria-expanded` too, and a menu that reopens itself
 * on load is a bug rather than a memory.
 *
 * **Anything keyed on an entity id.** `applications.<id>.checks` writes a key per row
 * ever looked at, nothing ever removes them, and the keys outlive the rows. If a panel
 * genuinely needs per-application memory it should be one JSON map under one key with a
 * cap on it, not this.
 *
 * ## The rule that comes with it
 *
 * A remembered panel must HIDE its content rather than unmount it, the way
 * `ProposedSpend` does for `window.print`. Unmounted, a section someone collapsed three
 * weeks ago is silently missing from every board pack printed since.
 *
 * `localStorage` is per browser profile, not per user, so a collapsed card outlives a
 * sign-out onto the next person at that machine. That is the accepted trade for chrome
 * state; nothing here is worth reading and no server round trip is spent on it.
 */

/** Namespaced so `forgetRememberedUi` can find its own keys and nothing else's. */
const PREFIX = 'custodian:ui:'

/**
 * Same-tab subscribers. The `storage` event fires only in OTHER tabs — the tab that
 * called `setOpen` has to be woken by hand, or the panel it was clicked in would not
 * re-render.
 */
const listeners = new Set<() => void>()

/**
 * `null` for both "never chosen" and "storage refused to answer", which are the same
 * thing to a caller: use the panel's own default. Storage throws outright in a
 * locked-down browser — same reasoning as the guard in `staleChunk.ts`.
 */
function readKey(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

/**
 * Stored state → the boolean a panel renders. Exported for its test: everything else
 * in this module needs a DOM, and the unit suite runs in node.
 *
 * Anything other than the two values written below is treated as absent rather than
 * falsy — a key left behind by an older shape of this module must not resolve to
 * "collapsed" for a panel whose default is open.
 */
export function resolveRemembered(stored: string | null, fallback: boolean): boolean {
  if (stored === '1') return true
  if (stored === '0') return false
  return fallback
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

/**
 * `useState` for a disclosure, with the answer kept across reloads.
 *
 * `key` names the panel's MEANING and is stable for the life of the panel — it is a
 * stored value, so renaming one silently forgets what every existing user chose.
 */
export function useRemembered(key: string, fallback: boolean): [boolean, (next: boolean) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => readKey(key),
    // The server has no storage, so it renders the default and so does hydration.
    () => null,
  )

  const setOpen = useCallback(
    (next: boolean) => {
      try {
        localStorage.setItem(PREFIX + key, next ? '1' : '0')
      } catch {
        // A full or disabled store costs the user the memory, not the click: the
        // notify below still re-renders, and `readKey` will report "never chosen".
      }
      for (const onChange of listeners) onChange()
    },
    [key],
  )

  return [resolveRemembered(stored, fallback), setOpen]
}

/**
 * Drops every remembered panel state. Not called anywhere yet — it exists so that if
 * shared-machine sign-out ever needs to leave nothing behind, the prefix is already the
 * thing that makes it possible.
 */
export function forgetRememberedUi(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX))
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    /* nothing to clear if the store cannot be read */
  }
}
