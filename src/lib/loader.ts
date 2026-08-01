import { notFound } from '@tanstack/react-router'
import { statusOf } from './errors'

/**
 * Turn a 404 from a server function into the router's own `notFound()`.
 *
 * Without this a bad id in the URL is just an error, and the response goes out as
 * 200 with an error page inside it — which quietly lies to crawlers, uptime checks and
 * anything else reading status codes. Routing it through `notFound()` sets a real 404
 * on the SSR response and picks up `defaultNotFoundComponent`.
 *
 * Everything that isn't a 404 propagates untouched to the error boundary.
 */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise
  } catch (err) {
    if (statusOf(err) === 404) throw notFound()
    throw err
  }
}
