import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { authClient } from '../../lib/auth-client'
import { invalidateCurrentUser } from '../../lib/currentUser'
import { removeProfilePhoto, updateProfilePhoto } from '../../server/fns/avatar'
import { getMyEmailPreferences, setWeeklyFinanceDigest } from '../../server/fns/users'
import {
  AvatarError,
  cropAvatar,
  loadAvatarSource,
  type AvatarCrop,
  type AvatarSource,
} from '../../lib/avatar'
import { AvatarCropper } from '../../components/AvatarCropper'
import {
  Avatar,
  Button,
  ErrorNote,
  Input,
  Label,
  Panel,
  PanelTitle,
  TextLink,
  Toggle,
} from '../../components/ui'
import { C } from '../../components/ui/tokens'
import { longerTimeout } from '../../lib/requestTimeout'

export const Route = createFileRoute('/_authenticated/profile')({
  loader: async () => ({ emailPrefs: await getMyEmailPreferences() }),
  component: Profile,
})

/**
 * Make the shell catch up with a change to your own row.
 *
 * The header's avatar and name come from `_authenticated`'s route CONTEXT, which
 * `beforeLoad` builds from `currentUser()` — and that is a five-minute client-side
 * cache in front of `getMe` (see `lib/currentUser.ts`, which exists because the router
 * re-runs `beforeLoad` on every link hover). `router.invalidate()` re-runs `beforeLoad`
 * faithfully; it just gets the same cached answer back, so a new photo did not appear
 * in the top right until a full page reload threw the cache away with the tab.
 *
 * So the cache has to be dropped FIRST, and then the router asked to reload.
 */
async function refreshIdentity(router: ReturnType<typeof useRouter>) {
  invalidateCurrentUser()
  await router.invalidate()
}

/** The setting's own copy, announced with the switch rather than left beside it. */
const DIGEST_COPY_ID = 'weekly-digest-explainer'

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  trustee: 'Trustee',
  finance: 'Finance',
}

function Profile() {
  const { user } = Route.useRouteContext()
  const { emailPrefs } = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // ── Email preferences ────────────────────────────────────────────────────────
  // Flipped optimistically and reverted on failure — the switch tracks the intent, not
  // the request (see the note on `Toggle`).
  const [digest, setDigest] = useState(emailPrefs.weeklyFinanceDigest)
  const [digestBusy, setDigestBusy] = useState(false)
  const [digestError, setDigestError] = useState('')

  async function handleDigestToggle(next: boolean) {
    setDigest(next)
    setDigestBusy(true)
    setDigestError('')
    try {
      await setWeeklyFinanceDigest({ data: { enabled: next } })
    } catch {
      setDigest(!next)
      setDigestError('Could not save that. Try again.')
    } finally {
      setDigestBusy(false)
    }
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
      await refreshIdentity(router)
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
      await refreshIdentity(router)
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
      // The header carries the name too — and, with no photo, its initials.
      await refreshIdentity(router)
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

      {emailPrefs.available && (
        <Panel label="Email">
          <PanelTitle>Email</PanelTitle>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-display text-body font-medium" style={{ color: C.ink }}>
                Weekly payment reminders
              </p>
              <p
                id={DIGEST_COPY_ID}
                className="mt-0.5 font-display text-body leading-relaxed"
                style={{ color: C.sub }}
              >
                A Monday email listing the grant payments due that week, and anything already
                overdue. Nothing is sent in a week with no payments due.
              </p>
            </div>
            <Toggle
              checked={digest}
              onChange={handleDigestToggle}
              busy={digestBusy}
              label="Weekly payment reminders"
              describedBy={DIGEST_COPY_ID}
            />
          </div>
          <ErrorNote error={digestError} className="mt-3" />
        </Panel>
      )}

      {user.role === 'superadmin' && (
        <Panel label="Platform">
          <PanelTitle>Platform console</PanelTitle>
          <p className="-mt-2 font-display text-body" style={{ color: C.sub }}>
            Signing in as a foundation's member moved to its own screen, off the foundation shell
            this page sits in. <TextLink to="/platform">Open the platform console</TextLink>.
          </p>
        </Panel>
      )}
    </div>
  )
}
