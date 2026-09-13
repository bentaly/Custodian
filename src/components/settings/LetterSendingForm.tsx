// ─── Settings › Letters › how both letters are sent ─────────────────────────────
//
// Sender name and reply-to, and they sit ABOVE the tabs because that is what they are:
// one setting governing both letters, not a field the award letter happens to own.
// They were on the award tab, which made the decline tab explain that it inherited them
// and link back — a sentence that only had to exist because the field was in the wrong
// place. What is shared goes above the tabs; what differs per letter goes below.
//
// Its own Save, separate from the tab's. Two forms, two saves, each labelled with what
// it writes — a single save spanning both would mean editing the reply-to on the award
// tab silently wrote the decline letter's template too.

import { useState } from 'react'
import { updateAwardLetterSettings } from '../../server/fns/awardSetup'
import { AwardLetterSettingsSchema } from '../../lib/validators/awardSetup'
import { Button, ErrorNote, Input, Label, Panel, PanelTitle, UnsavedChangesGuard } from '../ui'
import { C } from '../ui/tokens'

const hintClass = 'mt-1.5 font-display text-label text-grey-500'

export function LetterSendingForm({
  foundationName,
  senderName: initialSenderName,
  replyTo: initialReplyTo,
}: {
  foundationName: string
  senderName: string | null
  replyTo: string | null
}) {
  const [senderName, setSenderName] = useState(initialSenderName ?? '')
  const [replyTo, setReplyTo] = useState(initialReplyTo ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [replyToTouched, setReplyToTouched] = useState(false)

  // Trimmed, because the server's check does not trim: a pasted address with a trailing
  // space would otherwise be refused as invalid while looking perfectly fine in the box.
  const payload = { senderName: senderName || null, replyTo: replyTo.trim() || null }
  const [baseline, setBaseline] = useState(() => ({
    senderName: initialSenderName || null,
    replyTo: initialReplyTo || null,
  }))
  const dirty = JSON.stringify(payload) !== JSON.stringify(baseline)
  // The server's own rule, not a lookalike regex, so the form can never pass what the
  // server fn then refuses — which surfaced as "Something went wrong at our end".
  const replyToInvalid = !AwardLetterSettingsSchema.shape.replyTo.safeParse(payload.replyTo).success
  // Said once they leave the field, not while an address is still half-typed.
  const showReplyToError = replyToInvalid && replyToTouched

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // Only these two keys go in the payload, so saving here can never touch either
      // letter's template (`updateAwardLetterSettings` writes only what it is sent).
      await updateAwardLetterSettings({ data: payload })
      setBaseline(payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel label="How your letters are sent">
      <PanelTitle>How your letters are sent</PanelTitle>
      <p className="-mt-2 mb-4 font-display text-body leading-relaxed" style={{ color: C.sub }}>
        Both letters below go out under your foundation’s name, and replies to either come back to
        you.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="letter-sender-name">Sender name</Label>
          <Input
            id="letter-sender-name"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder={foundationName || 'Your foundation'}
          />
          <p className={hintClass}>
            Shown as the sender. The email itself is sent by Custodian’s mail service. Mail
            providers check the sending domain against its DNS records, so a letter claiming to come
            from your own domain would be treated as forged and land in spam.
          </p>
        </div>
        <div>
          <Label htmlFor="letter-reply-to">Reply-to address</Label>
          <Input
            id="letter-reply-to"
            type="email"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
            onBlur={() => setReplyToTouched(true)}
            placeholder="grants@yourfoundation.org"
            aria-invalid={showReplyToError || undefined}
            aria-describedby={showReplyToError ? 'letter-reply-to-error' : undefined}
            className={showReplyToError ? 'ring-2 ring-danger/40!' : undefined}
          />
          {showReplyToError && (
            <p id="letter-reply-to-error" className="mt-1.5 font-display text-label text-danger">
              Enter a valid email address, like grants@yourfoundation.org.
            </p>
          )}
          <p className={hintClass}>
            Where a reply lands. Set this, or replies come back to Custodian rather than to you.
          </p>
        </div>
      </div>
      {/* Save at the foot, bottom right: it comes after the fields it saves. */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <ErrorNote error={error} className="mr-auto" />
        {dirty && !saving && (
          <span className="font-display text-label" style={{ color: C.sub }}>
            Unsaved changes
          </span>
        )}
        <Button
          variant="secondary"
          onClick={handleSave}
          disabled={saving || !dirty || replyToInvalid}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <UnsavedChangesGuard dirty={dirty} what="your sender name and reply-to address" />
    </Panel>
  )
}
