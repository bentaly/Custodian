import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from '../../drizzle/schema'

// Lazy init so that this module can be imported on the client (via the
// createServerFn module graph) without throwing — neon() is only called
// when a server function actually runs a query.
export function getDb() {
  return drizzle(neon(process.env['DATABASE_URL'] ?? 'postgresql://localhost/unused'), { schema })
}
