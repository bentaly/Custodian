import { useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { invalidateCurrentUser } from '../../lib/currentUser'
import { longerTimeout } from '../../lib/requestTimeout'
import { LogoError, cropLogo, loadLogoSource, type LogoCrop, type LogoSource } from '../../lib/logo'
import { removeOrganisationLogo, updateOrganisationLogo } from '../../server/fns/logo'
import { renameOrganisation } from '../../server/fns/organisation'
import {
  Button,
  ErrorNote,
  Input,
  Label,
  Panel,
  PanelTitle,
  UnsavedChangesGuard,
  initials,
  toast,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { SettingsPage } from '../../components/SettingsPage'
import { LogoCropper } from '../../components/LogoCropper'

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

  // The name, saved on a button like every other Settings form.
  const [savedName, setSavedName] = useState(user.clientName ?? '')
  const [draftName, setDraftName] = useState(user.clientName ?? '')
  const [renaming, setRenaming] = useState(false)
  const [nameError, setNameError] = useState('')
  const nameDirty = draftName.trim() !== savedName && draftName.trim() !== ''
  const name = user.clientName ?? 'Your foundation'

  // The cached identity holds the old logo; drop it before the router reloads, or the
  // header keeps the monogram until a full page load (see `profile.tsx`'s twin).
  async function refreshIdentity() {
    invalidateCurrentUser()
    await router.invalidate()
  }

  // The logo being positioned, between choosing a file and saving it.
  const [source, setSource] = useState<LogoSource | null>(null)
  function closeCropper() {
    setSource((s) => {
      s?.release()
      return null
    })
  }
  // Free the preview URL if the page is left mid-positioning.
  useEffect(() => () => source?.release(), [source])

  async function open(file: File) {
    setError('')
    try {
      closeCropper()
      setSource(await loadLogoSource(file))
    } catch (err) {
      setError(err instanceof LogoError ? err.message : 'Could not read that image.')
    }
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Cleared so picking the same file again after an error still fires a change.
    e.target.value = ''
    if (file) await open(file)
  }

  async function handleConfirm(crop: LogoCrop) {
    if (!source) return
    setBusy(true)
    setError('')
    try {
      const prepared = await cropLogo(source, crop)
      const { logoUrl } = await updateOrganisationLogo({
        data: prepared,
        headers: longerTimeout(60_000),
      })
      setLogo(logoUrl)
      closeCropper()
      await refreshIdentity()
      toast('Logo saved')
    } catch (err) {
      setError(err instanceof LogoError ? err.message : 'Could not save that logo.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRename() {
    setRenaming(true)
    setNameError('')
    try {
      const { name: saved } = await renameOrganisation({ data: { name: draftName } })
      setSavedName(saved)
      setDraftName(saved)
      await refreshIdentity()
      toast('Name saved')
    } catch {
      setNameError('Could not save the name.')
    } finally {
      setRenaming(false)
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
      <Panel label="Name">
        <PanelTitle>Name</PanelTitle>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleRename()
          }}
          className="flex flex-col gap-1.5"
        >
          <Label htmlFor="organisation-name">Your foundation&rsquo;s name</Label>
          <Input
            id="organisation-name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={255}
            disabled={renaming}
          />
          <p className="font-display text-label" style={{ color: C.sub }}>
            Shown across Custodian and on every letter you send from now on. Letters already sent
            keep the name they went out with.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
            <ErrorNote error={nameError} className="mr-auto" />
            <Button type="submit" disabled={renaming || !nameDirty}>
              {renaming ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Panel>

      <Panel label="Logo">
        <PanelTitle>Logo</PanelTitle>
        <div className="flex flex-wrap items-center gap-4">
          {/* The logo on white and square, as a letter draws it, so what is seen here is
              what a charity sees at the top of their letter. */}
          <div
            className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-control border"
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
        {source && (
          <div className="mt-4">
            <LogoCropper
              source={source}
              busy={busy}
              onCancel={closeCropper}
              onConfirm={handleConfirm}
            />
          </div>
        )}
      </Panel>
      <UnsavedChangesGuard dirty={nameDirty} what="your foundation's name" />
    </SettingsPage>
  )
}
