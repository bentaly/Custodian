// ─── Bearer auth for internally-triggered endpoints ──────────────────────────
//
// Some endpoints exist to be called by the platform rather than by a person: the
// weekly cron, and the queue consumer that runs the ingest pipeline. Both are
// publicly routable URLs, so both need a gate, and both use the same shared secret
// as a bearer token.
//
// Fails closed, the same shape as `requireAdminToken`: no configured secret means
// every request is refused. A Worker missing the secret is unreachable rather than
// wide open — the safer of the two ways to be misconfigured.

/** Constant-time-ish comparison against a secret in the environment. */
export function bearerAuthorised(request: Request, secretName: string): boolean {
  const expected = process.env[secretName]
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  const provided = match?.[1]?.trim()
  if (!provided || provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i)
  return diff === 0
}

export function unauthorised(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorised' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
