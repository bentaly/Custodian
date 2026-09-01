// ─── Surviving a deploy the user is in the middle of ─────────────────────────
//
// Every deploy gives the built assets new hashed filenames, and the old ones stop
// being served. A browser holding the previous page then asks for a chunk that no
// longer exists, and the navigation dies with:
//
//     TypeError: Failed to fetch dynamically imported module: .../sign-in-BicXUhpP.js
//
// which is exactly the error Sentry recorded on custodian.fund during the audit's own
// deploys on 2026-08-27. The user sees a click that does nothing, or a blank pane, and
// nothing recovers until they reload by hand — on a route-split app where almost every
// screen is its own chunk, so it can happen on any navigation.
//
// It is not a code bug and there is nothing to fix in the chunk. The correct response
// is to fetch the new page, which is what a reload does.
//
// Vite raises `vite:preloadError` for precisely this case, so the detection is theirs
// rather than a string match on an error message that varies by browser.

/**
 * Reloads survive the page they were decided on, so the guard has to as well —
 * `sessionStorage`, not a module variable. Without it a genuinely broken deploy
 * (assets that 404 for everyone, not just the stale client) becomes a reload loop,
 * which is worse than the blank pane: it burns the user's battery and hides the real
 * failure behind a flickering page.
 */
const GUARD_KEY = 'custodian:chunk-reloaded-at'

/** Long enough that a second failure means something else is wrong. */
const REPEAT_WINDOW_MS = 30_000

function recentlyReloaded(): boolean {
  try {
    const at = Number(sessionStorage.getItem(GUARD_KEY))
    return Number.isFinite(at) && at > 0 && Date.now() - at < REPEAT_WINDOW_MS
  } catch {
    // Storage can throw outright in a locked-down browser. Treat it as "reload already
    // attempted": refusing to reload leaves a broken page, whereas guessing the other
    // way risks the loop this guard exists to prevent.
    return true
  }
}

/**
 * True from the moment a reload is decided until the page actually goes away.
 *
 * That gap is not instant, and it is not quiet. `preventDefault()` above does more
 * than silence the unhandled rejection: Vite's preload helper ends
 * `return importer().catch(handlePreloadError)`, and `handlePreloadError` only
 * rethrows when the event was NOT prevented. Prevented, it returns nothing — so the
 * import **resolves with `undefined`** instead of rejecting, and the next line of
 * TanStack's `lazyRouteComponent` reads `undefined['component']`:
 *
 *     TypeError: Cannot read properties of undefined (reading 'component')
 *
 * which is what Sentry recorded on staging on 2026-09-01 while this handler was doing
 * exactly its job. Everything thrown after this point is debris from a page that is
 * already on its way out, so `sentry.client` drops it — see the check in `beforeSend`.
 *
 * A module variable, not `sessionStorage`, and deliberately the opposite of
 * `recentlyReloaded`'s reasoning: that guard has to outlive the page, this one must
 * NOT. It is only ever true in the seconds before a reload, and the fresh page it
 * reloads into must start reporting again immediately.
 */
let reloading = false

export function isReloadingForStaleChunk(): boolean {
  return reloading
}

export function installStaleChunkReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (recentlyReloaded()) return
    // Vite's default is to throw the error onward, which surfaces it as an unhandled
    // rejection. We are handling it, so stop that.
    event.preventDefault()
    reloading = true
    try {
      sessionStorage.setItem(GUARD_KEY, String(Date.now()))
    } catch {
      /* handled by recentlyReloaded's own catch on the next attempt */
    }
    // Reloads the page they are on, not the one they were heading to: the event
    // carries the failed module, not the route that wanted it, and guessing the target
    // from a chunk filename is not worth the failure mode of guessing it wrong. The
    // user loses one click and gets a working app, which is the whole objective.
    window.location.reload()
  })
}
