import { createFileRoute } from '@tanstack/react-router'
import { REPORT_CANONICAL_FIELDS } from '../../lib/fieldMapping'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// The report canonical field registry, served to the admin app (same reasoning as
// /api/admin/canonical-fields: no hand-maintained copy). `coerce` is dropped.
export const Route = createFileRoute('/api/admin/report-canonical-fields')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        GET: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          const fields = REPORT_CANONICAL_FIELDS.map((f) => ({
            key: f.key,
            label: f.label,
            required: f.required,
            description: f.description,
          }))
          return adminJson(fields, 200)
        },
      },
    },
  } as any,
)
