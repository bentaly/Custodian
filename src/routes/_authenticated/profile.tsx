import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { authClient } from '../../lib/auth-client'
import { listClients } from '../../server/fns/platform'
import { removeProfilePhoto, updateProfilePhoto } from '../../server/fns/avatar'
import {
  AvatarError,
  cropAvatar,
  loadAvatarSource,
  type AvatarCrop,
  type AvatarSource,
} from '../../lib/avatar'
import { AvatarCropper } from '../../components/AvatarCropper'
import { Avatar, Button, ErrorNote, Input, Label, Panel, PanelTitle } from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { longerTimeout } from '../../lib/requestTimeout'

export const Route = createFileRoute('/_authenticated/profile')({
  // Impersonation targets are only needed for platform superadmins; everyone
  // else skips the (superadmin-gated) query entirely.
  loader: async ({ context }) =>
    context.user.role === 'superadmin' ? { clients: await listClients() } : { clients: [] },
  component: Profile,
})

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  trustee: 'Trustee',
  finance: 'Finance',
}

function Profile() {
  const { user } = Route.useRouteContext()
  const { clients } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [impersonateError, setImpersonateError] = useState('')

  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)
  async function handleImpersonate(userId: string) {
    setImpersonatingId(userId)
    const { error: impError } = await authClient.admin.impersonateUser({ userId })
    if (impError) {
      setImpersonatingId(null)
      setImpersonateError(impError.message ?? 'Could not start impersonation')
      return
    }
    // Full reload so server-side session/context is re-read as the impersonated user.
    // Deliberately no reset of the busy state — the button stays disabled until the
    // navigation lands.
    window.location.href = '/dashboard'
  }

  // ── Profile photo ────────────────────────────────────────────────────────────
  const fileInput = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState(user.image ?? null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState('')

  // Set once a file is decoded; the cropper is shown until the user saves or cancels.
  const [source, setSource] = useState<AvatarSource | null>(null)

  function closeCropper() {
    setSource((s) => {
      s?.release()
      return null
    })
  }
  // Free the preview object URL if the user navigates away mid-crop.
  useEffect(() => () => source?.release(), [source])

  async function handlePhotoPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Clear the input so re-picking the same file still fires a change event.
    e.target.value = ''
    if (!file) return

    setPhotoError('')
    try {
      closeCropper()
      setSource(await loadAvatarSource(file))
    } catch (err) {
      setPhotoError(err instanceof AvatarError ? err.message : 'Could not read that image.')
    }
  }

  async function handlePhotoConfirm(crop: AvatarCrop) {
    if (!source) return
    setPhotoBusy(true)
    setPhotoError('')
    try {
      const prepared = await cropAvatar(source, crop)
      // Uploading image bytes takes longer than the default deadline the fetch wrapper
      // applies (see lib/requestTimeout) — but it still gets one.
      const { image } = await updateProfilePhoto({
        data: prepared,
        headers: longerTimeout(60_000),
      })
      setPhoto(image)
      closeCropper()
      // The header reads `user.image` from route context, which the router must refetch.
      await router.invalidate()
    } catch (err) {
      setPhotoError(err instanceof AvatarError ? err.message : 'Could not upload that photo.')
    } finally {
      setPhotoBusy(false)
    }
  }

  async function handlePhotoRemove() {
    setPhotoBusy(true)
    setPhotoError('')
    try {
      await removeProfilePhoto()
      setPhoto(null)
      await router.invalidate()
    } catch {
      setPhotoError('Could not remove that photo.')
    } finally {
      setPhotoBusy(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (name === user.name) return
    setSaving(true)
    setError('')
    setSaved(false)

    const { error: updateError } = await authClient.updateUser({ name })
    setSaving(false)
    if (updateError) {
      setError(updateError.message ?? 'Failed to update name')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    // Capped like the settings pages, and wearing their header — this screen sat at
    // `max-w-lg` with a `font-semibold` title, which made it the narrowest and heaviest
    // page in the app.
    <div className="flex max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-heading font-medium" style={{ color: C.ink }}>
          Profile
        </h1>
        <p className="font-display text-body" style={{ color: C.sub }}>
          Your account details, and how you appear to the rest of your foundation.
        </p>
      </div>

      <Panel label="Photo">
        <PanelTitle>Photo</PanelTitle>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={user.name} image={photo} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
                disabled={photoBusy}
              >
                {photoBusy ? 'Uploading…' : photo ? 'Change photo' : 'Upload photo'}
              </Button>
              {photo && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handlePhotoRemove}
                  disabled={photoBusy}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-1.5 font-display text-label" style={{ color: C.sub }}>
              JPEG, PNG or WebP, up to 10MB. You can reposition it after choosing.
            </p>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={handlePhotoPick}
            className="hidden"
          />
        </div>
        <ErrorNote error={photoError} className="mt-3" />
        {source && (
          <div className="mt-4">
            <AvatarCropper
              source={source}
              busy={photoBusy}
              onCancel={closeCropper}
              onConfirm={handlePhotoConfirm}
            />
          </div>
        )}
      </Panel>

      <Panel label="Account">
        <PanelTitle
          right={
            <span className="font-display text-label font-medium" style={{ color: C.faint }}>
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          }
        >
          Account
        </PanelTitle>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="max-w-sm">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="max-w-sm">
            <Label htmlFor="profile-email">Email</Label>
            {/* A disabled field on the app's own field surface, rather than a hand-painted
                grey box: the address is how you sign in, and changing it is not a profile
                edit. */}
            <Input id="profile-email" type="email" value={user.email} readOnly disabled />
            <p className="mt-1.5 font-display text-label" style={{ color: C.faint }}>
              Your email is how you sign in and cannot be changed here.
            </p>
          </div>
          <ErrorNote error={error} />
          <div>
            <Button type="submit" disabled={saving || name === user.name}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
            </Button>
          </div>
        </form>
      </Panel>

      {user.role === 'superadmin' && (
        <Panel label="Impersonation">
          <PanelTitle>Log in as a foundation</PanelTitle>
          <p className="-mt-2 mb-3 font-display text-body" style={{ color: C.sub }}>
            See a foundation's data as one of its members. Create foundations from the admin app.
          </p>
          <ErrorNote error={impersonateError} className="mb-3" />
          {clients.length === 0 && (
            <p className="font-display text-body" style={{ color: C.sub }}>
              No foundations yet.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {clients.map((client) => (
              <div
                key={client.id}
                className="rounded-control border p-3"
                style={{ borderColor: C.line }}
              >
                <p className="font-display text-body font-medium" style={{ color: C.ink }}>
                  {client.name}
                </p>
                <ul className="mt-2 flex flex-col">
                  {client.users.length === 0 && (
                    <li className="font-display text-label" style={{ color: C.faint }}>
                      No members yet — admin invite pending.
                    </li>
                  )}
                  {client.users.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 border-t py-2 first:border-t-0"
                      style={{ borderColor: C.wash }}
                    >
                      <span className="min-w-0 truncate font-display text-body">
                        <span style={{ color: C.body }}>{u.name}</span>{' '}
                        <span style={{ color: C.faint }}>· {u.email}</span>
                      </span>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleImpersonate(u.id)}
                        disabled={impersonatingId !== null}
                      >
                        {impersonatingId === u.id ? 'Signing in…' : 'Log in as'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
