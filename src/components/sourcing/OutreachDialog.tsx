import { useState } from 'react'
import { messageFor } from '../../lib/errors'
import {
  defaultOutreach,
  outreachNeedsLink,
  OUTREACH_LINK_LABEL,
  type OutreachKind,
} from '../../lib/sourcing/outreach'
import { Button, Dialog, Input, Label, Textarea } from '../ui'
import { C } from '../ui/tokens'

// The one dialog every email to an organisation that has not applied yet goes through:
// a plain message, an invitation to send an expression of interest, an invitation to
// apply. Shared by the partnership screen and the EOI screen, so an invitation reads and
// behaves the same whichever of them it is sent from.
//
// **It shows the email, and it sends the email it shows.** The text is the admin's to
// edit; the link is stated beneath it rather than typed into it, because the server adds
// the invitation reference to that link and a reference somebody could mistype is one
// that silently fails to bring the form back. The link is pasted each time: nothing about
// a foundation's forms is stored in Custodian.
//
// **"I've sent it myself" is a different act and is offered as one.** Plenty of
// foundations will invite a partner from their own inbox, or over lunch. Pressing it
// sends nothing and records the admin's statement that they did.

export type OutreachValues = {
  to: string
  subject: string
  body: string
  formUrl: string | null
}

const TITLE: Record<OutreachKind, string> = {
  message: 'Email',
  eoi_invite: 'Invite to submit an expression of interest',
  apply_invite: 'Invite to apply',
}

export function OutreachDialog({
  kind,
  organisationName,
  defaultTo,
  contactName,
  programmeName,
  sender,
  onSend,
  onMarkSent,
  onClose,
}: {
  kind: OutreachKind
  organisationName: string
  defaultTo: string | null
  contactName: string | null
  programmeName: string | null
  sender: { foundationName: string; senderName: string | null; replyTo: string | null }
  /** Rejects with the reason when the email could not be sent. */
  onSend: (values: OutreachValues) => Promise<void>
  /** Record that it was sent some other way. Absent for a plain message. */
  onMarkSent?: () => Promise<void>
  onClose: () => void
}) {
  const start = defaultOutreach(kind, {
    foundationName: sender.foundationName,
    programmeName,
    contactName,
    senderName: sender.senderName,
  })
  const needsLink = outreachNeedsLink(kind)
  const [to, setTo] = useState(defaultTo ?? '')
  const [subject, setSubject] = useState(start.subject)
  const [body, setBody] = useState(start.body)
  const [formUrl, setFormUrl] = useState('')
  const [busy, setBusy] = useState<'send' | 'mark' | null>(null)
  const [error, setError] = useState('')

  const complete =
    to.trim() !== '' &&
    subject.trim() !== '' &&
    body.trim() !== '' &&
    (!needsLink || formUrl.trim() !== '')

  async function run(which: 'send' | 'mark') {
    if (busy) return
    setBusy(which)
    setError('')
    try {
      if (which === 'send') {
        await onSend({
          to: to.trim(),
          subject: subject.trim(),
          body: body.trim(),
          formUrl: needsLink ? formUrl.trim() : null,
        })
      } else {
        await onMarkSent?.()
      }
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open
      title={`${TITLE[kind]}${kind === 'message' ? ` ${organisationName}` : ''}`}
      description={
        kind === 'message'
          ? 'Sent by Custodian in your foundation’s name, and recorded in the relationship history.'
          : `Custodian emails ${organisationName} a link to your own form. What they send back is tied to this record.`
      }
      onClose={onClose}
      busy={busy !== null}
      size="lg"
      footer={
        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="font-display text-body text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {onMarkSent ? (
              <Button variant="ghost" disabled={busy !== null} onClick={() => run('mark')}>
                {busy === 'mark' ? 'Recording…' : 'I’ve sent it myself'}
              </Button>
            ) : (
              <span />
            )}
            <Button disabled={busy !== null || !complete} onClick={() => run('send')}>
              {busy === 'send' ? 'Sending…' : 'Send email'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="o-to">To</Label>
          <Input
            id="o-to"
            type="email"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@organisation.org.uk"
          />
        </div>
        <div>
          <Label htmlFor="o-subject">Subject</Label>
          <Input id="o-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="o-body">Email</Label>
          <Textarea id="o-body" rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        {needsLink && kind !== 'message' && (
          <div>
            <Label htmlFor="o-link">Link to your form</Label>
            <Input
              id="o-link"
              type="url"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="https://"
            />
            <p className="mt-1.5 font-display text-label" style={{ color: C.sub }}>
              Added under the email as “{OUTREACH_LINK_LABEL[kind]}”, with a reference on it so
              their form comes back to this record. Your form needs a hidden field called{' '}
              <code className="font-mono">custodian_ref</code> for that to work.
            </p>
          </div>
        )}
        <p
          className="font-display text-label"
          style={{ color: sender.replyTo ? C.sub : C.warning }}
        >
          {sender.replyTo
            ? `Sent as ${sender.senderName ?? sender.foundationName}. Replies go to ${sender.replyTo}.`
            : 'No reply-to address is set, so a reply to this email will not reach you. Add one in Settings, Letters, before sending.'}
        </p>
      </div>
    </Dialog>
  )
}
