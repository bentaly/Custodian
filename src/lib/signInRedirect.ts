/**
 * Where sign-in sends you afterwards.
 *
 * Two places lose a session and both want the same answer — `unauthorizedRedirect` in
 * `src/start.ts` (a server function said 401 mid-page) and `_authenticated.beforeLoad`
 * (navigating to a protected route with no session). Signing back in should return you
 * to the application you were reading, not to the dashboard, which is a different
 * screen and loses your place.
 *
 * It travels in the URL rather than in storage on purpose. The OAuth round trip leaves
 * this origin entirely and returns through a fresh page load, so anything held in
 * memory is gone by then; and a value in `localStorage` outlives the sign-in it was
 * written for, so the NEXT deliberate visit to /sign-in would fling the user somewhere
 * they did not ask to go. A query parameter expires exactly when the attempt does.
 */

/** Where you land when there is nothing to return to. */
export const DEFAULT_LANDING = '/dashboard'

const AUTH_PATHS = new Set(['/sign-in', '/sign-up'])

/**
 * The return path, if it is one we are willing to send a browser to.
 *
 * This is an **open-redirect gate**, which is why it whitelists a shape rather than
 * blacklisting hosts: the parameter is attacker-supplied by definition — it arrives in
 * a link anyone can compose and email to a user — and a sign-in page that forwards
 * anywhere afterwards is the classic phishing lever. The victim really does sign in to
 * Custodian, then lands on someone else's page with every reason to trust it.
 *
 * A leading `/` is NOT sufficient. Browsers read `//host` and `/\host` as
 * protocol-relative URLs and resolve them off-origin, so both are refused explicitly.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  // A control character can hide the real target from anyone reading the link.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null

  // Returning to an auth screen is a loop, not a return.
  const path = value.split(/[?#]/)[0]
  if (path && AUTH_PATHS.has(path)) return null

  return value
}

/** The sign-in URL that remembers where you were. */
export function signInPath(from: string): string {
  const target = safeReturnPath(from)
  return target ? `/sign-in?redirect=${encodeURIComponent(target)}` : '/sign-in'
}

/**
 * BetterAuth's own rule for a relative `callbackURL`, mirrored so a Google sign-in
 * cannot fail on a path we were happy with.
 *
 * It applies `allowRelativePaths` to `callbackURL` / `errorCallbackURL` and rejects
 * anything outside this character set with a 403 (`INVALID_CALLBACK_URL`) — which
 * would surface as "Google sign-in failed" on a perfectly ordinary application page.
 * Two characters make that reachable in practice: a route containing a bracket, and
 * `encodeURIComponent`, which leaves `!'()*~` unescaped.
 *
 * A deliberate DUPLICATE of a rule that lives in `better-auth`
 * (`auth/trusted-origins.mjs`), and the only honest way to keep the two in step is to
 * stay strictly narrower than it: if their rule loosens we are merely conservative,
 * and if it tightens the fallback below still lands somewhere real. It is not a
 * security check — `safeReturnPath` is — it is a compatibility check.
 */
const BETTER_AUTH_CALLBACK = /^\/(?!\/|\\)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/

/** `candidate` if BetterAuth will accept it as a callback, otherwise `fallback`. */
export function oauthCallback(candidate: string, fallback: string): string {
  return BETTER_AUTH_CALLBACK.test(candidate) ? candidate : fallback
}
