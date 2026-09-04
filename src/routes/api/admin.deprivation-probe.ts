import { createFileRoute } from '@tanstack/react-router'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'
import { resolveDeprivation, type ResolveTrace } from '../../server/deprivation/run'

// Runs one free-text location through the real deprivation pipeline and returns every
// intermediate step. Read-only: it writes nothing and belongs to no application.
//
// It exists because the failure this pipeline was rewritten for was INVISIBLE. A
// delivery area of "Preston" resolved to East Lothian and looked, on the application,
// exactly like a correct answer — which is why it survived in production for months.
// The only way to catch a wrong match is to see what was matched, what KIND of thing
// Google said it was, and which geography that justified.
//
// The trace comes from a single pass of `resolveDeprivation` rather than from
// re-running the steps here. Re-running would cost a second Google call and, worse,
// could explain an answer different from the one it just showed you.
//
// Cost note: one Google geocode per probe, on the place-name branch only — a postcode
// never reaches Google. Well inside the 10,000/month free allowance, but this is a
// hand-driven tool, so it is not something to put behind a poll.
export const Route = createFileRoute('/api/admin/deprivation-probe')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      POST: async ({ request }: { request: Request }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        let location = ''
        try {
          const body = (await request.json()) as { location?: unknown }
          location = typeof body.location === 'string' ? body.location.trim() : ''
        } catch {
          return adminJson({ error: 'Body must be JSON: { "location": "…" }' }, 400)
        }
        if (!location) return adminJson({ error: 'A location is required' }, 400)

        const trace: ResolveTrace = {}
        const result = await resolveDeprivation(location, trace)

        const g = trace.google
        return adminJson(
          {
            input: location,
            // Absent on the postcode branch, which never calls Google at all — the
            // single most useful thing this screen can show about cost.
            google:
              g == null
                ? null
                : g.kind === 'match'
                  ? {
                      kind: 'match' as const,
                      name: g.place.name,
                      types: g.place.types,
                      extentKm: Number(g.place.extentKm.toFixed(2)),
                      partialMatch: g.place.partialMatch,
                      locationType: g.place.locationType,
                    }
                  : g.kind === 'unavailable'
                    ? { kind: 'unavailable' as const, reason: g.reason }
                    : { kind: 'no_match' as const },
            area: trace.area
              ? {
                  wardName: trace.area.wardName,
                  ladName: trace.area.ladName,
                  region: trace.area.region,
                  pfa: trace.area.pfa,
                  country: trace.area.country,
                }
              : null,
            level: trace.level ?? null,
            result,
          },
          200,
        )
      },
    },
  },
} as any)
