// ─── Admin API helpers ───────────────────────────────────────────────────────
//
// The admin endpoints are called cross-origin by the (Cloudflare Access-gated)
// admin app, so they can't rely on the app's BetterAuth session. They're gated by
// a shared secret header instead: `x-admin-token` must equal `ADMIN_API_TOKEN`.
// Fails closed — if no token is configured, every request is rejected.

const ADMIN_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
}

export function adminOptions(): Response {
  return new Response(null, { status: 204, headers: ADMIN_CORS_HEADERS })
}

export function adminJson(data: unknown, status: number): Response {
  return new Response(
    JSON.stringify(data, (_key, val) => (val instanceof Date ? val.toISOString() : val)),
    { status, headers: { ...ADMIN_CORS_HEADERS, 'Content-Type': 'application/json' } },
  )
}

/** Returns a 401 Response when unauthorised, or null when the request may proceed. */
export function requireAdminToken(request: Request): Response | null {
  const expected = process.env['ADMIN_API_TOKEN']
  const provided = request.headers.get('x-admin-token')
  if (!expected || !provided || provided !== expected) {
    return adminJson({ error: 'Unauthorised' }, 401)
  }
  return null
}
