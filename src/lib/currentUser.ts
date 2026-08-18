import { getMe } from '../server/fns/auth'
import { cacheOnClient } from './clientCache'

/**
 * A browser-side cache in front of `getMe`.
 *
 * ## Why this exists
 *
 * `_authenticated.beforeLoad` awaits `getMe()`, and TanStack runs `beforeLoad` on
 * *every* load of a matched route — navigations and intent-preloads alike. It is
 * deliberately not gated by `staleTime`: `shouldSkipLoader` (router-core) checks only
 * dehydration and SSR, because the router treats "may I be here" as a question to
 * re-ask each time. `staleTime` and `preloadStaleTime` govern the LOADER only.
 *
 * With `defaultPreload: 'intent'` that means one network round trip per link hover. On
 * 17 Aug 2026 a real session made **eighteen `getMe` calls in 4.3 seconds** of ordinary
 * clicking, each a Worker invocation running two or three Neon queries. Caching has to
 * happen here, at the call, because the router will not do it for us.
 *
 * ## Why this is not a security boundary
 *
 * Every server function independently calls `requireAuthUser` / `requireRole`. A stale
 * client cache can therefore only mis-render the UI — showing a nav item that 403s when
 * clicked — never grant access. That is what lets the window be generous.
 *
 * ## Why five minutes
 *
 * The events that change the answer and that we can SEE — sign-in, sign-out, stopping
 * impersonation — invalidate explicitly. The TTL only covers what we cannot: an admin
 * changing someone's role from another session, or a session revoked elsewhere. Five
 * minutes matches the `staleTime` already on this route's own loader, so the two halves
 * of the same screen do not disagree about how fresh they are.
 */
const cache = cacheOnClient(() => getMe(), 5 * 60 * 1000)

export const currentUser = cache.read

/**
 * Drop the cached identity. Call around anything that changes who the caller is —
 * sign-in, sign-out, impersonation — so the next guard asks the server afresh.
 */
export const invalidateCurrentUser = cache.invalidate
