import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  CheckmarkCircle02Icon,
  MailOpen01Icon,
} from '@hugeicons/core-free-icons'
import { getDeclineBatch, sendDeclineLetters } from '../../server/fns/declineLetters'
import { planDeclineBatch, renderDeclineLetter } from '../../lib/declineLetter'
import { LetterCarousel } from '../LetterCarousel'
import { Button, Dialog, ErrorNote } from '../ui'
import { C } from '../ui/tokens'
import { fmtDate } from '../../lib/format'

type Batch = Awaited<ReturnType<typeof getDeclineBatch>>
type Recipient = Batch['recipients'][number]

/**
 * "Send decline letters" — the last act of a funding round.
 *
 * The dialog is a summary first and a control second, because the thing it does cannot
 * be undone: it emails third parties, under the foundation's name, to say no. So it
 * answers, in this order, the four questions an admin has before pressing it —
 *
 *   who is about to be emailed,          (the list, with the letter they will receive)
 *   who has already been told,           (so a second press is not a mystery)
 *   who cannot be reached,               (no contact email — a loose end for a human)
 *   and what is not decided yet.         (still in review: NOT in this batch, ever)
 *
 * The last of those is the reason the dialog exists rather than a confirm prompt. A
 * round can be closed with applications still unread, and those applicants are waiting
 * on an answer that this button will never send them.
 */
export function DeclineLettersDialog({
  open,
  roundId,
  onClose,
  onSent,
}: {
  open: boolean
  roundId: string
  onClose: () => void
  onSent: () => void
}) {
  const [batch, setBatch] = useState<Batch | null>(null)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [result, setResult] = useState<{ sent: number; withoutEmail: number } | null>(null)

  // Loaded on open rather than with the screen: it is a handful of queries nobody needs
  // until they ask, and re-reading each time is what makes the already-notified count
  // right when the dialog is opened a second time.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setResult(null)
    setPreviewIndex(0)
    getDeclineBatch({ data: { roundId } })
      .then((b) => !cancelled && setBatch(b))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, roundId])

  // The same rule the server applies when it writes (`planDeclineBatch`), so the count
  // on the button is the count that actually goes out.
  const { toNotify, alreadyNotified, unreachable, addressAlreadyWritten, duplicateInBatch } =
    useMemo(
      () =>
        planDeclineBatch({
          candidates: batch?.recipients ?? [],
          previouslyWritten: batch?.previouslyWritten ?? [],
        }),
      [batch],
    )

  const settings = batch?.settings ?? null

  /** The letter this organisation would receive — the same renderer the server stores. */
  function letterFor(r: Recipient) {
    return renderDeclineLetter({
      input: {
        organisationName: r.organisationName,
        foundationName: settings?.foundationName ?? 'Your Foundation',
        programmeName: r.programmeName,
        roundName: batch?.roundName ?? null,
        reference: r.reference,
        amountRequested: r.amountRequested,
        signatory: null,
        issuedAt: new Date(),
      },
      settings: settings?.settings ?? null,
      awardSignatory: settings?.awardSignatory ?? null,
    })
  }

  async function handleSend() {
    if (toNotify.length === 0) return
    setSending(true)
    setError('')
    try {
      const res = await sendDeclineLetters({
        data: { roundId, applicationIds: toNotify.map((r) => r.applicationId) },
      })
      setResult({ sent: res.sent, withoutEmail: res.withoutEmail })
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the decline letters')
    } finally {
      setSending(false)
    }
  }

  const nothingToDo = !loading && toNotify.length === 0

  return (
    <Dialog
      open={open}
      title="Send decline letters"
      description={
        batch
          ? `The unsuccessful applicants in ${batch.roundName}.`
          : 'The unsuccessful applicants in this round.'
      }
      onClose={onClose}
      busy={sending}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <ErrorNote error={error} />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={onClose} disabled={sending}>
              {result ? 'Done' : 'Cancel'}
            </Button>
            {!result && (
              <Button onClick={handleSend} disabled={sending || nothingToDo}>
                {sending
                  ? 'Sending…'
                  : toNotify.length === 1
                    ? 'Send 1 letter'
                    : `Send ${toNotify.length} letters`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {loading && (
        <p className="font-display text-body" style={{ color: C.sub }}>
          Working out who has not been told…
        </p>
      )}

      {result && (
        <div
          className="flex items-start gap-3 rounded-card p-4"
          style={{ backgroundColor: C.successWash }}
        >
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={20} color={C.success} />
          <div>
            <p className="font-display text-body font-medium" style={{ color: C.ink }}>
              {result.sent === 1
                ? '1 letter is on its way'
                : `${result.sent} letters are on their way`}
            </p>
            <p className="mt-1 font-display text-label leading-relaxed" style={{ color: C.sub }}>
              They are sent one at a time in the background, so they will not all arrive at once.
              Anything that fails to send is kept and shown here next time you open this.
            </p>
          </div>
        </div>
      )}

      {batch && !result && (
        <div className="flex flex-col gap-4">
          {/* ── Who is being emailed ── */}
          <div className="overflow-hidden rounded-card border" style={{ borderColor: C.line }}>
            <div
              className="flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: `1px solid ${C.line}` }}
            >
              <span className="font-display text-body" style={{ color: C.sub }}>
                Organisations to be emailed
              </span>
              <span
                className="font-display text-body font-medium tabular-nums"
                style={{ color: toNotify.length > 0 ? C.brand : C.sub }}
              >
                {toNotify.length}
              </span>
            </div>

            {toNotify.length > 0 ? (
              <ul className="max-h-56 overflow-y-auto">
                {toNotify.map((r, i) => (
                  <li
                    key={r.applicationId}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                    style={{ borderTop: i > 0 ? `1px solid ${C.line}` : undefined }}
                  >
                    <span
                      className="min-w-0 truncate font-display text-body"
                      style={{ color: C.ink }}
                    >
                      {r.organisationName}
                    </span>
                    <span
                      className="shrink-0 truncate font-display text-label"
                      style={{ color: C.sub }}
                    >
                      {r.applicantEmail}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 font-display text-body" style={{ color: C.sub }}>
                {/* Say WHICH kind of nothing this is. "No letters to send" over a round
                    with twelve declined applications reads as a bug unless the reason
                    is on screen, and the reason is one of three different things. */}
                {(batch.recipients ?? []).length === 0
                  ? 'Nobody in this round has been declined yet.'
                  : alreadyNotified.length + addressAlreadyWritten.length > 0
                    ? 'Everybody declined in this round has already had a letter.'
                    : 'Nobody left to write to — see below.'}
              </p>
            )}
          </div>

          {/* ── The three things that are true but not in the batch ── */}
          {batch.stillInReview > 0 && (
            <Note tone="warning">
              <strong style={{ color: C.ink }}>
                {batch.stillInReview === 1
                  ? '1 application in this round is still in review'
                  : `${batch.stillInReview} applications in this round are still in review`}
              </strong>{' '}
              — no decision has been recorded, so {batch.stillInReview === 1 ? 'it is' : 'they are'}{' '}
              not in this batch. Decline {batch.stillInReview === 1 ? 'it' : 'them'} first if you
              mean to tell {batch.stillInReview === 1 ? 'them' : 'them'} too.
            </Note>
          )}

          {unreachable.length > 0 && (
            <Note tone="warning">
              <strong style={{ color: C.ink }}>
                {unreachable.length === 1
                  ? '1 organisation has no contact email'
                  : `${unreachable.length} organisations have no contact email`}
              </strong>{' '}
              — {unreachable.map((r) => r.organisationName).join(', ')}. Their letter is written and
              kept, but cannot be sent until an address is on the application.
            </Note>
          )}

          {addressAlreadyWritten.length > 0 && (
            <Note tone="quiet">
              <strong style={{ color: C.ink }}>
                {addressAlreadyWritten.length === 1
                  ? '1 address has already had a decline letter'
                  : `${addressAlreadyWritten.length} addresses have already had a decline letter`}
              </strong>{' '}
              — no address is ever written to twice.{' '}
              {addressAlreadyWritten
                .map((r) =>
                  [
                    r.organisationName,
                    r.previous.roundName ? `told with ${r.previous.roundName}` : null,
                    r.previous.at ? `on ${fmtDate(r.previous.at)}` : 'not yet delivered',
                  ]
                    .filter(Boolean)
                    .join(', '),
                )
                .join('; ')}
              .
            </Note>
          )}

          {duplicateInBatch.length > 0 && (
            <Note tone="quiet">
              <strong style={{ color: C.ink }}>
                {duplicateInBatch.length === 1
                  ? '1 application shares an address with another in this round'
                  : `${duplicateInBatch.length} applications share an address with another in this round`}
              </strong>{' '}
              — {duplicateInBatch.map((r) => r.organisationName).join(', ')}. One letter goes to
              each address, not one per application.
            </Note>
          )}

          {alreadyNotified.length > 0 && (
            <Note tone="quiet">
              <strong style={{ color: C.ink }}>
                {alreadyNotified.length === 1
                  ? '1 organisation has already been told'
                  : `${alreadyNotified.length} organisations have already been told`}
              </strong>{' '}
              — nobody is emailed twice.{' '}
              {(() => {
                const failed = alreadyNotified.filter((r) => r.letterStatus === 'failed')
                if (failed.length === 0) return null
                return `${failed.length} of those letters failed to send (${failed
                  .map((r) => r.organisationName)
                  .join(', ')}).`
              })()}
            </Note>
          )}

          {/* ── The letter itself ── */}
          {toNotify.length > 0 && (
            <div>
              <div className="rounded-card border" style={{ borderColor: C.line }}>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-display text-body font-medium" style={{ color: C.ink }}>
                      {settings?.settings.template
                        ? 'Your decline letter'
                        : 'Standard decline letter'}
                    </div>
                    <div className="font-display text-label" style={{ color: C.sub }}>
                      The same letter goes to each of them, with their own details filled in.
                    </div>
                  </div>
                  <Button
                    variant="text"
                    icon={previewOpen ? ArrowUp01Icon : ArrowDown01Icon}
                    iconPosition="right"
                    onClick={() => setPreviewOpen(!previewOpen)}
                  >
                    {previewOpen ? 'Hide preview' : 'Preview'}
                  </Button>
                </div>
                {previewOpen && (
                  <LetterCarousel
                    items={toNotify}
                    index={Math.min(previewIndex, toNotify.length - 1)}
                    onIndex={setPreviewIndex}
                    labelFor={(r) => r.organisationName}
                    metaFor={(r) => r.applicantEmail}
                    letterFor={letterFor}
                  />
                )}
              </div>
              <p className="mt-2 font-display text-label" style={{ color: C.sub }}>
                Sent from{' '}
                <strong style={{ color: C.body }}>
                  {settings?.senderName || settings?.foundationName || 'your foundation'}
                </strong>
                {settings?.replyTo ? (
                  <>
                    , with replies going to{' '}
                    <strong style={{ color: C.body }}>{settings.replyTo}</strong>.{' '}
                  </>
                ) : (
                  <>. No reply-to address is set, so replies come back to Custodian. </>
                )}
                <Link
                  to="/settings/letters"
                  search={{ tab: 'decline' }}
                  className="font-medium hover:underline"
                  style={{ color: C.brand }}
                >
                  Change the letter in Settings
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

/**
 * The dialog's asides. Amber where something is left undone, quiet where it is merely
 * worth knowing — the same distinction `AwardWizard` draws between a problem that gates
 * and a fact that informs.
 */
function Note({ tone, children }: { tone: 'warning' | 'quiet'; children: React.ReactNode }) {
  const warning = tone === 'warning'
  return (
    <div
      className="flex items-start gap-2.5 rounded-card px-4 py-3 font-display text-label leading-relaxed"
      style={{
        backgroundColor: warning ? C.warningWash : C.wash,
        color: C.sub,
      }}
    >
      {warning && (
        <HugeiconsIcon icon={Alert02Icon} size={16} color={C.warning} className="mt-0.5 shrink-0" />
      )}
      {!warning && (
        <HugeiconsIcon
          icon={MailOpen01Icon}
          size={16}
          color={C.faint}
          className="mt-0.5 shrink-0"
        />
      )}
      <p>{children}</p>
    </div>
  )
}
