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

  const payload = { senderName: senderName || null, replyTo: replyTo || null }
  const [baseline, setBaseline] = useState(() => ({
    senderName: initialSenderName || null,
    replyTo: initialReplyTo || null,
  }))
  const dirty = JSON.stringify(payload) !== JSON.stringify(baseline)

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
      <PanelTitle
        right={
          <div className="flex items-center gap-3">
            {dirty && !saving && (
              <span className="font-display text-label" style={{ color: C.sub }}>
                Unsaved changes
              </span>
            )}
            <Button variant="secondary" size="xs" onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        }
      >
        How your letters are sent
      </PanelTitle>
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
            Shown as the sender. The email itself is sent by Custodian’s mail service — mail
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
            placeholder="grants@yourfoundation.org"
          />
          <p className={hintClass}>
            Where a reply lands. Set this — without it, replies come back to Custodian rather than
            to you.
          </p>
        </div>
      </div>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
      <UnsavedChangesGuard dirty={dirty} what="your sender name and reply-to address" />
    </Panel>
  )
}
