// The server half of `lib/features.ts`: which features this deployment runs.
//
// Keyed on `isProductionDeployment`, and the right way round for a feature still under
// review: on everywhere that is NOT production (staging, `pnpm dev`, `wrangler dev`),
// and off on production until somebody deletes the flag. An environment that forgets to
// say what it is gets the feature, which costs nothing, because only production holds a
// real foundation's work.

import { notFoundError } from '../lib/errors'
import type { Features } from '../lib/features'
import { isProductionDeployment } from './deployEnvironment'

export function features(): Features {
  return { sourcing: !isProductionDeployment() }
}

/**
 * Refuse a request for a feature this deployment does not run. A 404, not a 403: on
 * production the feature does not exist yet, and "you may not" would say that it does.
 */
export function requireFeature(name: keyof Features): void {
  if (!features()[name]) throw notFoundError()
}
