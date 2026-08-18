import { listMyRounds } from '../server/fns/rounds'
import { cacheOnClient } from './clientCache'

/**
 * `listMyRounds` for the two Shortlist `beforeLoad`s, which call it only to pick a
 * fallback round when the search param is absent and then redirect.
 *
 * Both routes call it twice per visit — once in `beforeLoad`, once in the loader — and
 * `beforeLoad` runs on every intent-preload, so hovering the Shortlist link repeatedly
 * re-fetched a list whose only use was choosing a default. Thirty seconds matches the
 * router's `defaultStaleTime`.
 *
 * Deliberately NOT used by the loaders: what they fetch is rendered, and rendered data
 * should follow the router's own freshness rules (including `router.invalidate()` after
 * a mutation), which this cache knows nothing about. A 30-second-old answer to "which
 * round should I default to" is harmless; a 30-second-old rendered round list after
 * someone edits a budget is not.
 */
const cache = cacheOnClient(() => listMyRounds(), 30_000)

export const myRoundsForFallback = cache.read
