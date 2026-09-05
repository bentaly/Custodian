import { useEffect, useState } from 'react'
import { addComment, deleteComment, listComments, updateComment } from '../../server/fns/comments'
import { Button, Dialog, ErrorNote, Textarea, initials } from '../ui'
import { fmtSince } from '../../lib/format'
import { C } from '../ui/tokens'

// The board's discussion on one application, over the vote card.
//
// The comps put a bare "Add a comment…" box in each vote card, which is the one thing a
// discussion box must never be: somewhere to write into without being shown what has
// already been said. A trustee typing "agreed with Helen's concern" cannot see Helen's
// concern, and two people write the same note. So the card carries a count instead, and
// the count opens the thread — read first, then reply, without leaving the decision.
//
// It is the SAME thread as the application screen's `CommentsSection`, so it offers the
// same control over it: a trustee who can withdraw a remark on the application detail
// page and not on the shortlist has been given a rule that depends on which door they
// came through. Author edits their own; author or admin deletes — `updateComment` and
// `deleteComment` enforce exactly that, and this only draws what they will allow.

type Comment = Awaited<ReturnType<typeof listComments>>[number]

export function CommentsDialog({
  applicationId,
  organisationName,
  userId,
  userRole,
  onClose,
  onChanged,
}: {
  applicationId: string
  organisationName: string
  /** The reader, so their own remarks can carry Edit / Delete. */
  userId: string
  userRole: string
  onClose: () => void
  /** Fired after a comment lands or goes, so the card's count can catch up. */
  onChanged: () => void
}) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const isAdmin = userRole === 'superadmin' || userRole === 'admin'

  useEffect(() => {
    let live = true
    listComments({ data: { applicationId } })
      .then((rows) => live && setComments(rows))
      .catch(
        (e) => live && setError(e instanceof Error ? e.message : 'Could not load the comments'),
      )
    return () => {
      live = false
    }
  }, [applicationId])

  async function post() {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    try {
      await addComment({ data: { applicationId, body: body.trim() } })
      setBody('')
      setComments(await listComments({ data: { applicationId } }))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post your comment')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(id: string) {
    if (!editBody.trim()) return
    setBusyId(id)
    setError(null)
    try {
      await updateComment({ data: { id, body: editBody.trim() } })
      setEditingId(null)
      setEditBody('')
      setComments(await listComments({ data: { applicationId } }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your change')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this comment?')) return
    setBusyId(id)
    setError(null)
    try {
      await deleteComment({ data: { id } })
      if (editingId === id) setEditingId(null)
      setComments(await listComments({ data: { applicationId } }))
      // The count on the card is now wrong by one, so it has to be told.
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that comment')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title="Discussion"
      description={organisationName}
      footer={
        <div className="flex flex-col gap-2">
          <ErrorNote error={error} />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add to the discussion…"
            rows={3}
            aria-label={`Comment on ${organisationName}`}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <Button onClick={post} disabled={busy || !body.trim()}>
              {busy ? 'Posting…' : 'Post comment'}
            </Button>
          </div>
        </div>
      }
    >
      {comments === null ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          Loading…
        </p>
      ) : comments.length === 0 ? (
        <p className="font-display text-body" style={{ color: C.sub }}>
          Nothing has been said about this application yet. Yours would be the first.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {comments.map((c) => {
            const mine = c.user?.id === userId
            const editing = editingId === c.id
            const rowBusy = busyId === c.id
            return (
              <li key={c.id} className="flex gap-3">
                <span
                  className="flex size-8 shrink-0 items-center justify-center rounded-full font-display text-label font-semibold"
                  style={{ backgroundColor: C.wash, color: C.sub }}
                >
                  {initials(c.user?.name ?? '—')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span
                      className="truncate font-display text-body font-medium"
                      style={{ color: C.ink }}
                    >
                      {c.user?.name ?? 'Unknown'}
                    </span>
                    <span className="shrink-0 font-display text-label" style={{ color: C.faint }}>
                      {fmtSince(c.createdAt)}
                      {c.updatedAt && ' · edited'}
                    </span>
                  </div>

                  {editing ? (
                    <div className="mt-1 flex flex-col gap-2">
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={3}
                        aria-label="Edit your comment"
                      />
                      <div className="flex justify-end gap-3">
                        <Button
                          variant="text"
                          size="xs"
                          onClick={() => setEditingId(null)}
                          disabled={rowBusy}
                          style={{ color: C.sub }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="text"
                          size="xs"
                          onClick={() => saveEdit(c.id)}
                          disabled={rowBusy || !editBody.trim()}
                        >
                          {rowBusy ? 'Saving…' : 'Save'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p
                        className="mt-0.5 whitespace-pre-line font-display text-body leading-relaxed"
                        style={{ color: C.body }}
                      >
                        {c.body}
                      </p>
                      {(mine || isAdmin) && (
                        <div className="mt-1 flex gap-3">
                          {mine && (
                            <Button
                              variant="text"
                              size="xs"
                              onClick={() => {
                                setEditingId(c.id)
                                setEditBody(c.body)
                              }}
                              disabled={rowBusy}
                              style={{ color: C.faint }}
                            >
                              Edit
                            </Button>
                          )}
                          <Button
                            variant="text"
                            size="xs"
                            onClick={() => remove(c.id)}
                            disabled={rowBusy}
                            style={{ color: rowBusy ? C.danger : C.faint }}
                          >
                            {rowBusy ? 'Deleting…' : 'Delete'}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Dialog>
  )
}
