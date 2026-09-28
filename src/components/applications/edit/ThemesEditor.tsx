import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { PencilEdit01Icon } from '@hugeicons/core-free-icons'
import { Button, Checkbox, ThemePill, Tooltip } from '../../ui'
import { C } from '../../ui/tokens'
import { setThemes } from '../../../server/fns/applicationEdits'
import { EditedMark, type EditRecord } from './EditedMark'

// An application's themes, and for an admin the way to change them. Choices come from
// the programme's own list (the same limit the AI works to), and once a person has
// chosen, a re-run of the assessment leaves them alone.
//
// The pencil appears on hover, like every other edit on this screen. Nothing at all is
// shown while the themes are unassigned and nobody may edit, which is the rule the
// screen had before: no fallback to the programme's whole list.

export function ThemesEditor({
  applicationId,
  themes,
  programmeThemes,
  canEdit,
  edits,
  waiting,
  lockedReason,
}: {
  applicationId: string
  themes: string[] | null
  programmeThemes: string[]
  canEdit: boolean
  edits: EditRecord[]
  /** The assessment has not run yet, so the AI has not picked any. */
  waiting: boolean
  /** Why an admin may no longer edit (votes cast, awarded): a greyed pencil says so. */
  lockedReason?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string[]>(themes ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const has = themes && themes.length > 0
  if (!has && !canEdit && !waiting) return null

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setThemes({ data: { id: applicationId, themes: draft } })
      await router.invalidate()
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group relative mt-3">
      <div className="flex flex-wrap items-center gap-1" aria-label="Themes">
        {has ? (
          themes.map((t) => <ThemePill key={t}>{t}</ThemePill>)
        ) : (
          <span className="font-display text-label" style={{ color: C.faint }}>
            {waiting ? 'Themes pending' : 'No themes yet'}
          </span>
        )}
        <EditedMark field="themes" edits={edits} />
        {canEdit && programmeThemes.length > 0 && (
          <button
            type="button"
            aria-label="Edit themes"
            aria-expanded={open}
            onClick={() => {
              setDraft(themes ?? [])
              setOpen((o) => !o)
            }}
            className="ml-1 inline-flex size-6 items-center justify-center rounded-chip border bg-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
            style={{ borderColor: C.line, color: C.body }}
          >
            <HugeiconsIcon icon={PencilEdit01Icon} size={12} strokeWidth={1.8} />
          </button>
        )}
        {!canEdit &&
          lockedReason &&
          programmeThemes.length > 0 && (
            // Same pencil, greyed, saying why, as on every other card.
            <span className="ml-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <Tooltip
                control
                label="Edit themes"
                trigger={
                  <button
                    type="button"
                    aria-label="Edit themes (not available)"
                    aria-disabled="true"
                    className="inline-flex size-6 cursor-not-allowed items-center justify-center rounded-chip border bg-white"
                    style={{ borderColor: C.line, color: C.faint }}
                  >
                    <HugeiconsIcon icon={PencilEdit01Icon} size={12} strokeWidth={1.8} />
                  </button>
                }
              >
                {lockedReason}
              </Tooltip>
            </span>
          )}
      </div>

      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-2 flex w-72 flex-col gap-2.5 rounded-card border bg-white p-3.5"
          style={{ borderColor: C.line, boxShadow: '0 8px 24px rgba(20,28,36,0.12)' }}
        >
          <p className="font-display text-label" style={{ color: C.sub }}>
            This programme&rsquo;s themes
          </p>
          {programmeThemes.map((t) => (
            <Checkbox
              key={t}
              checked={draft.includes(t)}
              onChange={(e) =>
                setDraft((d) => (e.target.checked ? [...d, t] : d.filter((x) => x !== t)))
              }
              label={
                <span className="font-display text-body" style={{ color: C.ink }}>
                  {t}
                </span>
              }
            />
          ))}
          <p
            className="border-t pt-2 font-display text-label"
            style={{ borderColor: C.line, color: C.sub }}
          >
            {waiting
              ? 'The AI picks themes when it assesses the application. Choosing now means it will keep yours.'
              : 'Re-running the AI assessment will not change themes you choose.'}
          </p>
          {error && (
            <p className="font-display text-label" style={{ color: C.danger }} role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy || draft.length === 0}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
