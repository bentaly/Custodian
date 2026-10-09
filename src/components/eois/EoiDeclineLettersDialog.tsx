import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowUp01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { getEoiDeclineBatch, sendEoiDeclineLetters } from '../../server/fns/eoiLetters'
import { planDeclineBatch } from '../../lib/declineLetter'
import { renderEoiDecline } from '../../lib/eoiLetters'
import { LetterCarousel } from '../LetterCarousel'
import { Note } from '../applications/DeclineLettersDialog'
import { Button, Dialog, ErrorNote } from '../ui'
import { C } from '../ui/tokens'
import { fmtDate } from '../../lib/format'

type Batch = Awaited<ReturnType<typeof getEoiDeclineBatch>>
type Recipient = Batch['recipients'][number]

/**
 * "Send decline letters" for one programme's expressions of interest.
 *
 * `DeclineLettersDialog`'s twin, built on the same rule (`planDeclineBatch`) so the count
 * on the button is the count that goes out. Declining an EOI emails nobody; this is
 * where the foundation tells them, once, when it is ready. What it does not have is the
 * round's "still in review" warning in the same words: an EOI still to review is simply
 * not decided yet, and the count is stated so nobody mistakes the batch for everyone.
 */
export function EoiDeclineLettersDialog({
  open,
  programmeId,
  onClose,
  onSent,
}: {
  open: boolean
  programmeId: string
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

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError('')
    setResult(null)
    setPreviewIndex(0)
    getEoiDeclineBatch({ data: { programmeId } })
      .then((b) => !cancelled && setBatch(b))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open, programmeId])

  const plan = useMemo(
    () =>
      planDeclineBatch({
        candidates: batch?.recipients ?? [],
        previouslyWritten: batch?.previouslyWritten ?? [],
      }),
    [batch],
  )
  const {
    toNotify,
    alreadyNotified,
    unnamed,
    unreachable,
    addressAlreadyWritten,
    duplicateInBatch,
  } = plan
  const settings = batch?.settings ?? null

  function letterFor(r: Recipient) {
    return renderEoiDecline(
      {
        organisationName: r.organisationName,
        foundationName: settings?.foundationName ?? 'Your Foundation',
        programmeName: batch?.programmeName ?? null,
        signatory: settings?.signatory ?? null,
      },
      settings?.declineTemplate,
    )
  }

  async function handleSend() {
    if (toNotify.length === 0) return
    setSending(true)
    setError('')
    try {
      const res = await sendEoiDeclineLetters({
        data: { programmeId, eoiIds: toNotify.map((r) => r.eoiId) },
      })
      setResult({ sent: res.sent, withoutEmail: res.withoutEmail })
      onSent()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the decline letters')
    } finally {
      setSending(false)
    }
  }

  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

  return (
    <Dialog
      open={open}
      title="Send decline letters"
      description={
        batch
          ? `The declined expressions of interest for ${batch.programmeName}.`
          : 'The declined expressions of interest for this programme.'
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
              <Button onClick={handleSend} disabled={sending || loading || toNotify.length === 0}>
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
              They are sent one at a time in the background. Anything that fails to send is kept and
              shown on the expression of interest.
            </p>
          </div>
        </div>
      )}

      {batch && !result && (
        <div className="flex flex-col gap-4">
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
                    key={r.eoiId}
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
                {batch.recipients.length === 0
                  ? 'Nothing for this programme has been declined yet.'
                  : alreadyNotified.length + addressAlreadyWritten.length > 0
                    ? 'Everybody declined here has already had a letter.'
                    : 'Nobody left to write to. See below.'}
              </p>
            )}
          </div>

          {batch.stillToReview > 0 && (
            <Note tone="warning">
              <strong style={{ color: C.ink }}>
                {plural(
                  batch.stillToReview,
                  '1 expression of interest is still to review',
                  `${batch.stillToReview} expressions of interest are still to review`,
                )}
              </strong>
              , so {plural(batch.stillToReview, 'it is', 'they are')} not in this batch. Decline{' '}
              {plural(batch.stillToReview, 'it', 'them')} first to tell them too.
            </Note>
          )}
          {unnamed.length > 0 && (
            <Note tone="warning">
              <strong style={{ color: C.ink }}>
                {plural(
                  unnamed.length,
                  '1 has no organisation name',
                  `${unnamed.length} have no organisation name`,
                )}
              </strong>
              : {unnamed.map((r) => r.organisationName).join(', ')}. No letter is written to them.
            </Note>
          )}
          {unreachable.length > 0 && (
            <Note tone="warning">
              <strong style={{ color: C.ink }}>
                {plural(
                  unreachable.length,
                  '1 organisation has no contact email',
                  `${unreachable.length} organisations have no contact email`,
                )}
              </strong>
              : {unreachable.map((r) => r.organisationName).join(', ')}. Their letter is written and
              kept, but cannot be sent without an address.
            </Note>
          )}
          {addressAlreadyWritten.length > 0 && (
            <Note tone="quiet">
              <strong style={{ color: C.ink }}>
                {plural(
                  addressAlreadyWritten.length,
                  '1 address has already had an EOI decline letter',
                  `${addressAlreadyWritten.length} addresses have already had an EOI decline letter`,
                )}
              </strong>
              . No address is written to twice.{' '}
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
                {plural(
                  duplicateInBatch.length,
                  '1 shares an address with another here',
                  `${duplicateInBatch.length} share an address with another here`,
                )}
              </strong>
              : {duplicateInBatch.map((r) => r.organisationName).join(', ')}. One letter goes to
              each address.
            </Note>
          )}
          {alreadyNotified.length > 0 && (
            <Note tone="quiet">
              <strong style={{ color: C.ink }}>
                {plural(
                  alreadyNotified.length,
                  '1 organisation has already been told',
                  `${alreadyNotified.length} organisations have already been told`,
                )}
              </strong>
              . Nobody is emailed twice.
            </Note>
          )}

          {toNotify.length > 0 && (
            <div>
              <div className="rounded-card border" style={{ borderColor: C.line }}>
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-display text-body font-medium" style={{ color: C.ink }}>
                      {settings?.declineTemplate
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
                  search={{ tab: 'eoi' }}
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
