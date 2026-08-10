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
import { Avatar, Button, Input } from '../../components/ui'
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
    <div className="max-w-lg">
      <h1 className="text-heading font-semibold text-gray-900">Profile</h1>
      <p className="mt-1 text-body text-gray-500">Your account details</p>

      <div className="mt-8 space-y-6">
        <div className="flex items-center gap-4">
          <Avatar name={user.name} image={photo} size={64} />
          <div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
                disabled={photoBusy}
              >
                {photoBusy ? 'Uploading…' : photo ? 'Change photo' : 'Upload photo'}
              </Button>
              {photo && (
                <button
                  type="button"
                  onClick={handlePhotoRemove}
                  disabled={photoBusy}
                  className="text-body text-gray-500 hover:text-gray-700 disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="mt-1.5 text-label text-gray-500">
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
        {photoError && <p className="text-body text-danger">{photoError}</p>}
        {source && (
          <AvatarCropper
            source={source}
            busy={photoBusy}
            onCancel={closeCropper}
            onConfirm={handlePhotoConfirm}
          />
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-body font-medium text-gray-700">Name</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div>
            <label className="block text-body font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={user.email}
              readOnly
              className="mt-1 w-full rounded-chip border border-gray-200 bg-gray-50 px-3 py-2 text-body text-gray-500 cursor-not-allowed"
            />
          </div>
          {error && <p className="text-body text-danger">{error}</p>}
          <Button type="submit" disabled={saving || name === user.name}>
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </Button>
        </form>

        <div className="border-t border-gray-100 pt-6 space-y-3">
          <div className="flex items-center justify-between text-body">
            <span className="text-gray-500">Role</span>
            <span className="font-medium text-gray-800">{ROLE_LABELS[user.role] ?? user.role}</span>
          </div>
        </div>

        {user.role === 'superadmin' && (
          <div className="border-t border-gray-100 pt-6">
            <h2 className="text-body font-semibold text-gray-900">Log in as a foundation</h2>
            <p className="mt-1 text-label text-gray-500">
              See a foundation's data as one of its members. Create foundations from the admin app.
            </p>
            {impersonateError && <p className="mt-2 text-body text-danger">{impersonateError}</p>}
            <div className="mt-3 space-y-3">
              {clients.length === 0 && <p className="text-body text-gray-500">No foundations yet.</p>}
              {clients.map((client) => (
                <div key={client.id} className="rounded-card border border-gray-200 p-3">
                  <p className="text-body font-medium text-gray-900">{client.name}</p>
                  <div className="mt-2 space-y-1">
                    {client.users.length === 0 && (
                      <p className="text-label text-gray-400">
                        No members yet — admin invite pending.
                      </p>
                    )}
                    {client.users.map((u) => (
                      <div key={u.id} className="flex items-center justify-between text-body">
                        <span className="text-gray-600">
                          {u.name} · <span className="text-gray-400">{u.email}</span>
                        </span>
                        <button
                          onClick={() => handleImpersonate(u.id)}
                          disabled={impersonatingId !== null}
                          className="rounded-chip border border-gray-300 px-2 py-1 text-label text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {impersonatingId === u.id ? 'Signing in…' : 'Log in as'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
