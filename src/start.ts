import { createMiddleware, createStart } from '@tanstack/react-start'
import { toClientError } from './server/errors'

/**
 * Runs around every server function, so error handling cannot be forgotten at a call
 * site. There are ~40 throw sites across `src/server/fns/`; wrapping each one by hand
 * would guarantee that the one added next month is the one that leaks a stack trace.
 *
 * `toClientError` decides what the caller may see — see that file for the reasoning.
 */
const errorMiddleware = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  try {
    return await next()
  } catch (err) {
    throw await toClientError(err)
  }
})

/**
 * Start's global configuration entry, discovered by filename (`src/start.ts`).
 */
export const startInstance = createStart(() => ({
  functionMiddleware: [errorMiddleware],
}))
