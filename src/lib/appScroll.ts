/**
 * The id of the app's scroll container — the `<main>` in `_authenticated`.
 *
 * Its own module rather than a constant in either place that needs it: `router.tsx`
 * builds the route tree that `_authenticated.tsx` belongs to, so importing one from the
 * other is a cycle. Two hand-typed copies of the string would be worse — a rename in
 * one place would silently stop the scroll reset, with nothing failing to say so.
 */
export const APP_SCROLL_ID = 'app-main'

/** How the router addresses that element (see `scrollToTopSelectors`). */
export const APP_SCROLL_SELECTOR = `[data-scroll-restoration-id="${APP_SCROLL_ID}"]`
