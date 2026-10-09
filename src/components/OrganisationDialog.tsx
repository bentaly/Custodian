import { useEffect, useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { invalidateCurrentUser } from '../lib/currentUser'
import { longerTimeout } from '../lib/requestTimeout'
import { LogoError, cropLogo, loadLogoSource, type LogoCrop, type LogoSource } from '../lib/logo'
import { removeOrganisationLogo, updateOrganisationLogo } from '../server/fns/logo'
import { renameOrganisation } from '../server/fns/organisation'
import { Button, Dialog, ErrorNote, Input, Label, initials, toast } from './ui'
import { C } from './ui/tokens'
import { LogoCropper } from './LogoCropper'

// The foundation's name and logo, opened from the organisation chip at the top of every
// screen (admins only). The chip IS the thing being edited, so that is where it is
// changed, rather than on a Settings page somebody has to find.
//
// The two halves save separately, as they did on the page: the name on the dialog's
// Save, the logo on the cropper's own "Save logo" (or Remove) the moment it is done.
// Both are written by their own server fns (`fns/organisation.ts`, `fns/logo.ts`), and
// the logo's size limits are explained in `lib/logo.ts`.

export function OrganisationDialog({
  open,
  onClose,
  name,
  logo: initialLogo,
}: {
  open: boolean
  onClose: () => void
  name: string
  logo: string | null
}) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)

  const [draftName, setDraftName] = useState(name)
  const [renaming, setRenaming] = useState(false)
  const [nameError, setNameError] = useState('')

  const [logo, setLogo] = useState(initialLogo)
  const [source, setSource] = useState<LogoSource | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState('')

  const nameDirty = draftName.trim() !== '' && draftName.trim() !== name
  const busy = renaming || logoBusy

  function closeCropper() {
    setSource((s) => {
      s?.release()
      return null
    })
  }
  // Free the preview URL if the dialog closes mid-positioning.
  useEffect(() => () => source?.release(), [source])

  // The cached identity holds the old name and logo; drop it before the router reloads,
  // or the header keeps them until a full page load (see `profile.tsx`'s twin).
  async function refreshIdentity() {
    invalidateCurrentUser()
    await router.invalidate()
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Cleared so picking the same file again after an error still fires a change.
    e.target.value = ''
    if (!file) return
    setLogoError('')
    try {
      closeCropper()
      setSource(await loadLogoSource(file))
    } catch (err) {
      setLogoError(err instanceof LogoError ? err.message : 'Could not read that image.')
    }
  }

  async function handleLogoConfirm(crop: LogoCrop) {
    if (!source) return
    setLogoBusy(true)
    setLogoError('')
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
      setLogoError(err instanceof LogoError ? err.message : 'Could not save that logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleLogoRemove() {
    setLogoBusy(true)
    setLogoError('')
    try {
      await removeOrganisationLogo()
      setLogo(null)
      await refreshIdentity()
      toast('Logo removed')
    } catch {
      setLogoError('Could not remove the logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleRename() {
    if (!nameDirty) return
    setRenaming(true)
    setNameError('')
    try {
      await renameOrganisation({ data: { name: draftName } })
      await refreshIdentity()
      toast('Name saved')
      onClose()
    } catch {
      setNameError('Could not save the name.')
    } finally {
      setRenaming(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      title="Your foundation"
      description="Its name and logo, as shown across Custodian and on every letter you send."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ErrorNote error={nameError} className="mr-auto" />
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {nameDirty ? 'Cancel' : 'Close'}
          </Button>
          <Button type="submit" form="organisation-form" disabled={busy || !nameDirty}>
            {renaming ? 'Saving…' : 'Save'}
          </Button>
        </div>
      }
    >
      <form
        id="organisation-form"
        onSubmit={(e) => {
          e.preventDefault()
          void handleRename()
        }}
        className="flex flex-col gap-1.5"
      >
        <Label htmlFor="organisation-name">Name</Label>
        <Input
          id="organisation-name"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          maxLength={255}
          disabled={renaming}
        />
        <p className="font-display text-label" style={{ color: C.sub }}>
          Letters already sent keep the name they went out with.
        </p>
      </form>

      <div className="mt-6 flex flex-col gap-1.5">
        <Label>Logo</Label>
        <div className="flex flex-wrap items-center gap-4">
          {/* Square and on white, as the header and a letter draw it. */}
          <div
            className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-control border"
            style={{ borderColor: C.line }}
          >
            {logo ? (
              <img src={logo} alt={name} className="max-h-full max-w-full object-contain" />
            ) : (
              <span
                className="flex size-10 items-center justify-center rounded-chip bg-grey-100 font-display text-body font-semibold"
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
                disabled={busy || source !== null}
              >
                {logo ? 'Change logo' : 'Upload logo'}
              </Button>
              {logo && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleLogoRemove}
                  disabled={busy || source !== null}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-1.5 font-display text-label" style={{ color: C.sub }}>
              PNG, JPEG or SVG. It replaces your initials at the top of Custodian and heads every
              letter you send.
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
        <ErrorNote error={logoError} className="mt-2" />
        {source && (
          <div className="mt-3">
            <LogoCropper
              source={source}
              busy={logoBusy}
              onCancel={closeCropper}
              onConfirm={handleLogoConfirm}
            />
          </div>
        )}
      </div>
    </Dialog>
  )
}
