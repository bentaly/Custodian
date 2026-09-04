import { useState } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { currentUser, invalidateCurrentUser } from '../lib/currentUser'
import { listClients, startImpersonation } from '../server/fns/platform'
import { authClient } from '../lib/auth-client'
import { Avatar, Button, ErrorNote, LogoMark, TOKENS as C } from '../components/ui'

// The platform console: what a superadmin sees instead of a foundation.
//
// ## Why this is not a screen inside the app
//
// It sits OUTSIDE `_authenticated` deliberately, and that is the whole point of the
// route rather than an accident of where the file landed. The app shell is a
// foundation's shell — a sidebar of that foundation's screens, a pill naming it, a
// round selector over its rounds — and a superadmin has no foundation. Rendered in that
// shell, a platform operator gets a Dashboard, an Applications list and a Finance
// section that either answer for nobody or, worse, answer for everybody at once.
//
// That is not hypothetical. On 3 Sep 2026 a superadmin whose `users.client_id` still
// pointed at an old test tenant read one foundation's application under another
// foundation's name in the header, because the role-based scope exemption showed every
// tenant's applications while the pill showed the caller's own client. Two models of
// what a superadmin is, disagreeing on one screen. This route picks one: a superadmin
// operates the platform, and the only way to see a foundation's data is to become one
// of its members, which is what the impersonation session already does properly.
//
// So there is exactly one control here. Everything else a platform operator needs —
// provisioning foundations, clearing held submissions, teaching field mappings — lives
// in the admin app behind `x-admin-token`, not behind this session.

export const Route = createFileRoute('/platform')({
  beforeLoad: async () => {
    const user = await currentUser()
    if (!user) throw redirect({ to: '/sign-in' })
    // A foundation's member has no business here, and sending them to their own
    // dashboard is the honest answer rather than a permission error: they are not
    // being denied something they were reaching for.
    if (user.role !== 'superadmin') throw redirect({ to: '/dashboard' })
  },
  loader: async () => ({ clients: await listClients() }),
  component: PlatformConsole,
})

function PlatformConsole() {
  const { clients } = Route.useLoaderData()
  const navigate = useNavigate()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function handleImpersonate(userId: string) {
    setBusyId(userId)
    setError('')

    // Audit first, while this session is still the superadmin's — the moment
    // BetterAuth swaps the cookie the caller IS the member, and the row could no
    // longer be attributed. See `startImpersonation`.
    try {
      await startImpersonation({ data: { userId } })
    } catch {
      setBusyId(null)
      setError('Could not start that session. Try again.')
      return
    }

    const { error: impError } = await authClient.admin.impersonateUser({ userId })
    if (impError) {
      setBusyId(null)
      setError(impError.message ?? 'Could not start impersonation')
      return
    }
    invalidateCurrentUser()
    // Full reload so the server re-reads the session as the impersonated member and
    // the app shell is built from THEIR client. Busy state is deliberately not reset —
    // the button stays disabled until the navigation lands.
    window.location.href = '/dashboard'
  }

  async function handleSignOut() {
    await authClient.signOut()
    invalidateCurrentUser()
    navigate({ to: '/sign-in' })
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header
        className="flex h-[74px] shrink-0 items-center justify-between gap-4 border-b px-4"
        style={{ borderColor: C.line }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <LogoMark className="h-9 w-9" />
          <div className="min-w-0">
            <p className="font-display text-body font-medium" style={{ color: C.ink }}>
              Custodian Platform
            </p>
            <p className="truncate font-display text-label" style={{ color: C.sub }}>
              Superadmin
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={handleSignOut}>
          Sign out
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
              Foundations
            </h1>
            <p className="font-display text-body" style={{ color: C.sub }}>
              Choose a member to sign in as. You'll see exactly what they see, and the foundation's
              audit log records that you were there. Create foundations from the admin app.
            </p>
          </div>

          <ErrorNote error={error} />

          {clients.length === 0 && (
            <p className="font-display text-body" style={{ color: C.sub }}>
              No foundations yet.
            </p>
          )}

          {clients.map((client) => (
            <section
              key={client.id}
              className="rounded-control border"
              style={{ borderColor: C.line }}
            >
              <h2
                className="border-b px-4 py-3 font-display text-body font-medium"
                style={{ borderColor: C.line, color: C.ink }}
              >
                {client.name}
              </h2>
              {client.users.length === 0 ? (
                <p className="px-4 py-3 font-display text-label" style={{ color: C.faint }}>
                  No members yet — admin invite pending.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {client.users.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 border-t px-4 py-2.5 first:border-t-0"
                      style={{ borderColor: C.wash }}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={u.name} size={32} />
                        <span className="min-w-0 truncate font-display text-body">
                          <span style={{ color: C.body }}>{u.name}</span>{' '}
                          <span style={{ color: C.faint }}>· {u.email}</span>
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleImpersonate(u.id)}
                        disabled={busyId !== null}
                      >
                        {busyId === u.id ? 'Signing in…' : 'Sign in as'}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
