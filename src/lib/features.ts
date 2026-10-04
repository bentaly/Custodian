// ─── Features that are switched on by environment ────────────────────────────
//
// A feature flag in the plainest form that works here: some features are live on
// staging (and in local dev) and not yet on production. Both Workers are built from the
// same commit, so this cannot be a build-time switch; it is decided at runtime, on the
// server, from `SENTRY_ENVIRONMENT` (`server/features.ts`), and handed to the browser on
// the signed-in user (`getMe`) so every screen reads the same answer without asking again.
//
// **The server is the boundary, the browser only hides doors.** Every server function and
// public endpoint of a flagged feature refuses on its own (`requireFeature`); the rail,
// the route guards and the Applications tab exist so nobody on production is shown a
// link that 404s. Same split as `canSeePayments`.
//
// To ship a feature to production, delete its key here and let the type checker find
// every place that asked.

export type Features = {
  /**
   * Partnerships (sourcing prospects, screening, inviting) and expressions of interest
   * (the `/api/eoi` intake and the tab on Applications). Built 2026-10-02, on staging
   * while it is reviewed.
   */
  sourcing: boolean
}

/** For a caller that has no user to read the flags off (signed out, or loading). */
export const NO_FEATURES: Features = { sourcing: false }
