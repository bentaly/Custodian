import { createFileRoute, notFound, redirect } from '@tanstack/react-router'

// The EOI list moved into the Applications card on 2026-10-04 (a switch beside the
// programme pill, `components/eois/EoiList`). This address is kept so a bookmark or an
// old link still lands somewhere sensible: the card, on its EOI view, for the foundation's
// default round and programme.
export const Route = createFileRoute('/_authenticated/applications/eois/')({
  beforeLoad: ({ context }) => {
    if (!context.user.features.sourcing) throw notFound()
    throw redirect({ to: '/applications', search: { view: 'eois' }, replace: true })
  },
})
