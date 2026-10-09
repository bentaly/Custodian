import { useRef, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { invalidateCurrentUser } from '../../lib/currentUser'
import { longerTimeout } from '../../lib/requestTimeout'
import { LogoError, prepareLogo } from '../../lib/logo'
import { removeOrganisationLogo, updateOrganisationLogo } from '../../server/fns/logo'
import { Button, ErrorNote, Panel, PanelTitle, initials, toast } from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { SettingsPage } from '../../components/SettingsPage'

// Who the foundation is, as Custodian presents it: today its name and its logo. The logo
// replaces the monogram in the header and heads every letter the foundation sends (award
// and decline letters, the expression of interest letters, invitations), which is why it
// is set here rather than on the Letters page: it is the foundation's, not one letter's.

export const Route = createFileRoute('/_authenticated/settings/organisation')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  component: OrganisationDetails,
})

function OrganisationDetails() {
  const { user } = Route.useRouteContext()
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [logo, setLogo] = useState<string | null>(user.clientLogo ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = user.clientName ?? 'Your foundation'

  // The cached identity holds the old logo; drop it before the router reloads, or the
  // header keeps the monogram until a full page load (see `profile.tsx`'s twin).
  async function refreshIdentity() {
    invalidateCurrentUser()
    await router.invalidate()
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Cleared so picking the same file again after an error still fires a change.
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const prepared = await prepareLogo(file)
      const { logoUrl } = await updateOrganisationLogo({
        data: prepared,
        headers: longerTimeout(60_000),
      })
      setLogo(logoUrl)
      await refreshIdentity()
      toast('Logo saved')
    } catch (err) {
      setError(err instanceof LogoError ? err.message : 'Could not save that logo.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove() {
    setBusy(true)
    setError('')
    try {
      await removeOrganisationLogo()
      setLogo(null)
      await refreshIdentity()
      toast('Logo removed')
    } catch {
      setError('Could not remove the logo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPage
      title="Organisation details"
      description="How your foundation appears in Custodian and on the letters it sends."
    >
      <Panel label="Organisation">
        <PanelTitle>Name</PanelTitle>
        <p className="font-display text-body" style={{ color: C.ink }}>
          {name}
        </p>
        <p className="mt-1 font-display text-label" style={{ color: C.sub }}>
          To change your foundation&rsquo;s name, contact us.
        </p>
      </Panel>

      <Panel label="Logo">
        <PanelTitle>Logo</PanelTitle>
        <div className="flex flex-wrap items-center gap-4">
          {/* The logo on white, at the size a letter draws it, so what is seen here is
              what a charity sees at the top of their letter. */}
          <div
            className="flex h-24 w-64 shrink-0 items-center justify-center rounded-control border p-3"
            style={{ borderColor: C.line }}
          >
            {logo ? (
              <img src={logo} alt={name} className="max-h-full max-w-full object-contain" />
            ) : (
              <span
                className="flex size-12 items-center justify-center rounded-chip bg-grey-100 font-display text-title font-semibold"
                style={{ color: C.ink }}
                aria-hidden
              >
                {initials(name)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
              >
                {busy ? 'Saving…' : logo ? 'Change logo' : 'Upload logo'}
              </Button>
              {logo && (
                <Button type="button" variant="ghost" onClick={handleRemove} disabled={busy}>
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-1.5 font-display text-label" style={{ color: C.sub }}>
              PNG, JPEG or SVG, up to 10MB. A logo on a transparent or white background works best.
              It replaces your initials at the top of Custodian, and heads every letter you send.
            </p>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={handlePick}
            className="hidden"
          />
        </div>
        <ErrorNote error={error} className="mt-3" />
      </Panel>
    </SettingsPage>
  )
}
