import { createFileRoute } from '@tanstack/react-router'
import { CANONICAL_FIELDS } from '../../lib/fieldMapping'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// The canonical field registry, served to the admin app so it never has to keep a
// hand-maintained copy in sync (it can't import the main app's source). `coerce` is a
// function and unserialisable, so it's dropped — the admin UI only needs the metadata.
export const Route = createFileRoute('/api/admin/canonical-fields')(
  {
    server: {
      handlers: {
        OPTIONS: async () => adminOptions(),
        GET: async ({ request }: { request: Request }) => {
          const denied = requireAdminToken(request)
          if (denied) return denied

          const fields = CANONICAL_FIELDS.map((f) => ({
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
