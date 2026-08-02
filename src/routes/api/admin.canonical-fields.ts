import { createFileRoute } from '@tanstack/react-router'
import { CANONICAL_FIELDS, REQUIRED_ONE_OF_GROUPS } from '../../lib/fieldMapping'
import { adminJson, adminOptions, requireAdminToken } from '../../server/admin/http'

// The canonical field registry, served to the admin app so it never has to keep a
// hand-maintained copy in sync (it can't import the main app's source). `coerce` is a
// function and unserialisable, so it's dropped — the admin UI only needs the metadata.
export const Route = createFileRoute('/api/admin/canonical-fields')({
  server: {
    handlers: {
      OPTIONS: async () => adminOptions(),
      GET: async ({ request }: { request: Request }) => {
        const denied = requireAdminToken(request)
        if (denied) return denied

        const fields = CANONICAL_FIELDS.map((f) => ({
          key: f.key,
          label: f.label,
          tier: f.tier,
          // Kept alongside `tier` for the admin app's asterisk: it means "blocks the
          // application", which is true of `required` and of an unsatisfied `one_of`
          // group — but the group constraint can't be expressed on a single field, so
          // the queue reads `tier` to render the pair properly.
          required: f.tier === 'required',
          // Which one-of group this field belongs to, or null. Sent rather than left
          // for the admin app to infer from `tier`, so a second group added here
          // doesn't silently merge into the first one over there.
          oneOfGroup: REQUIRED_ONE_OF_GROUPS.findIndex((g) => g.includes(f.key)),
          description: f.description,
        })).map((f) => ({ ...f, oneOfGroup: f.oneOfGroup === -1 ? null : f.oneOfGroup }))
        return adminJson(fields, 200)
      },
    },
  },
} as any)
