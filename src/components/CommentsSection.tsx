import { useState, useEffect, useCallback } from 'react'
import { listComments, addComment, updateComment, deleteComment } from '../server/fns/comments'
import { listApplicationActivity } from '../server/fns/activity'
import type { ApplicationActivityRow } from '../server/applicationActivity'
import { ACTION_LABEL } from '../lib/audit'
import { fmtDateTime, fmtSince } from '../lib/format'
import { messageFor } from '../lib/errors'
import { Button, Tabs } from './ui'
import { C as TOKENS } from './ui/tokens'

// Figma node 435:42458 — the full-width comment panel on the application detail
// screen: composer on top, then every comment as a moss-washed card with the author
// left and its age right. Deliberately unpaginated; a board's discussion of one
// application is short, and paging it hid the thread behind a control.
//
// ONE component for the discussion wherever it appears: here, and in the dialog the
// shortlist's comment button opens (`shortlist/CommentsDialog`). They were two
// implementations of one thread, drawn differently depending on which door you came
// through.
//
// For an admin it carries a second tab, Activity: what people have DONE to the
// application (shortlisted it, proposed a different amount and why, edited a field),
// as distinct from what they have said about it. The two are never mixed: a comment is
// not listed as activity, and nothing the app records is posted as a comment. Anybody
// else sees no tabs at all, only the discussion.

type Comment = {
  id: string
  body: string
  createdAt: string | Date
  updatedAt?: string | Date | null
  user: { id: string; name: string; role: string }
}

const C = {
  ...TOKENS,
  cardBg: 'rgba(31, 122, 92, 0.05)',
}

const CAN_COMMENT = new Set(['superadmin', 'admin', 'trustee', 'finance'])

function roleLabel(role: string) {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'trustee':
      return 'Trustee'
    case 'finance':
      return 'Finance'
    default:
      return role
  }
}

export function CommentsSection({
  applicationId,
  userId,
  userRole,
  onChanged,
  activityKey,
}: {
  applicationId: string
  userId: string
  userRole: string
  /** Fired after a comment lands or goes, so a count shown elsewhere can catch up. */
  onChanged?: () => void
  /**
   * Anything that changes when the application has been acted on. The Activity tab
   * fetches for itself, so a save elsewhere on the screen does not reach it; a new
   * value here makes it read again.
   */
  activityKey?: unknown
}) {
  const [tab, setTab] = useState<'comments' | 'activity'>('comments')
  const [activity, setActivity] = useState<ApplicationActivityRow[] | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  const canComment = CAN_COMMENT.has(userRole)
  const isAdmin = userRole === 'superadmin' || userRole === 'admin'

  // Every call here catches, and none of them rethrow. A rejected promise in an effect
  // or an event handler is invisible to React's error boundaries — it becomes an
  // unhandled rejection and a panel that does nothing. This one spent an unknown
  // stretch of 25 Aug 2026 saying "Loading…" to a signed-out trustee.
  const load = useCallback(async () => {
    try {
      const data = await listComments({ data: { applicationId } })
      setComments(data as Comment[])
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [applicationId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Read up front rather than when the tab is opened, so the tab can say how much is
  // behind it. A failure leaves the tab without a count and its list saying so; it must
  // not take the discussion down with it.
  useEffect(() => {
    if (!isAdmin) return
    let live = true
    listApplicationActivity({ data: { applicationId } })
      .then((rows) => live && setActivity(rows))
      .catch(() => live && setActivity(null))
    return () => {
      live = false
    }
  }, [applicationId, isAdmin, activityKey])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await addComment({ data: { applicationId, body: body.trim() } })
      setBody('')
      await load()
      onChanged?.()
    } catch (err) {
      setError(err)
    } finally {
      setSubmitting(false)
    }
  }

  function startEdit(c: Comment) {
    setEditingId(c.id)
    setEditBody(c.body)
  }

  async function handleSaveEdit(id: string) {
    if (!editBody.trim()) return
    setBusyId(id)
    setError(null)
    try {
      await updateComment({ data: { id, body: editBody.trim() } })
      setEditingId(null)
      setEditBody('')
      await load()
    } catch (err) {
      setError(err)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this comment?')) return
    setBusyId(id)
    setError(null)
    try {
      await deleteComment({ data: { id } })
      await load()
      onChanged?.()
    } catch (err) {
      setError(err)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {isAdmin ? (
        <Tabs<'comments' | 'activity'>
          ariaLabel="Comments and activity"
          value={tab}
          onChange={setTab}
          items={[
            { id: 'comments', label: 'Comments', count: loading ? undefined : comments.length },
            { id: 'activity', label: 'Activity', count: activity?.length },
          ]}
        />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-title font-medium" style={{ color: C.ink }}>
            Comments
          </h2>
          {!loading && comments.length > 0 && (
            <span className="font-display text-label" style={{ color: C.sub }}>
              {comments.length} comment{comments.length !== 1 ? 's' : ''} in total
            </span>
          )}
        </div>
      )}

      {tab === 'activity' ? (
        <ActivityList activity={activity} />
      ) : (
        <>
          {canComment && (
            <form onSubmit={handleSubmit} className="flex flex-col items-start gap-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add a comment for the panel…"
                className="h-[120px] w-full resize-none rounded-control border bg-white px-3 py-2 font-display text-body focus:outline-hidden"
                style={{ borderColor: C.line, color: C.ink }}
              />
              <Button variant="tinted" type="submit" disabled={submitting || !body.trim()}>
                {submitting ? 'Posting…' : 'Post comment'}
              </Button>
            </form>
          )}

          {error ? (
            <p className="font-display text-body" style={{ color: C.danger }}>
              {messageFor(error)}
            </p>
          ) : null}

          {loading ? (
            <p className="font-display text-body" style={{ color: C.faint }}>
              Loading…
            </p>
          ) : comments.length === 0 ? (
            <p className="font-display text-body" style={{ color: C.faint }}>
              No comments yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {comments.map((c) => {
                const canEdit = c.user.id === userId
                const canDelete = c.user.id === userId || isAdmin
                const isEditing = editingId === c.id
                const busy = busyId === c.id
                return (
                  <div
                    key={c.id}
                    className="flex flex-col gap-2 rounded-chip p-4"
                    style={{ backgroundColor: C.cardBg }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-display text-label">
                        <span className="font-medium" style={{ color: C.ink }}>
                          {c.user.name}
                        </span>
                        <span style={{ color: C.faint }}>{roleLabel(c.user.role)}</span>
                      </span>
                      <span className="font-display text-label" style={{ color: C.sub }}>
                        {fmtSince(c.createdAt)}
                        {c.updatedAt && ' · edited'}
                      </span>
                    </div>

                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={editBody}
                          onChange={(e) => setEditBody(e.target.value)}
                          rows={3}
                          className="w-full resize-none rounded-chip border bg-white px-3 py-2 font-display text-label focus:outline-hidden"
                          style={{ borderColor: C.line, color: C.ink }}
                        />
                        <div className="flex justify-end gap-3">
                          <Button
                            variant="text"
                            size="xs"
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                            style={{ color: C.sub }}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="text"
                            size="xs"
                            onClick={() => handleSaveEdit(c.id)}
                            disabled={busy || !editBody.trim()}
                          >
                            {busy ? 'Saving…' : 'Save'}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p
                          className="whitespace-pre-wrap font-display text-label leading-relaxed"
                          style={{ color: C.sub }}
                        >
                          {c.body}
                        </p>
                        {(canEdit || canDelete) && (
                          <div className="flex gap-3">
                            {canEdit && (
                              <Button
                                variant="text"
                                size="xs"
                                onClick={() => startEdit(c)}
                                disabled={busy}
                                className="text-label"
                                style={{ color: C.faint }}
                              >
                                Edit
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                variant="text"
                                size="xs"
                                onClick={() => handleDelete(c.id)}
                                disabled={busy}
                                className="text-label"
                                style={{ color: busy ? C.danger : C.faint }}
                              >
                                {busy ? 'Deleting…' : 'Delete'}
                              </Button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * What has been done to the application, newest first: what happened and its detail,
 * the reason somebody gave (whole, in their words), then who and when. Read-only by
 * construction, like the Activity screen in Settings these rows also appear on.
 */
function ActivityList({ activity }: { activity: ApplicationActivityRow[] | null }) {
  if (activity === null) {
    return (
      <p className="font-display text-body" style={{ color: C.faint }}>
        The activity could not be loaded. Refresh to try again.
      </p>
    )
  }
  if (activity.length === 0) {
    return (
      <p className="font-display text-body" style={{ color: C.faint }}>
        Nothing has been done to this application yet.
      </p>
    )
  }
  return (
    <ul className="flex flex-col">
      {activity.map((entry) => (
        <li
          key={entry.id}
          className="flex flex-col gap-0.5 border-t py-2.5 first:border-t-0 first:pt-0 last:pb-0"
          style={{ borderColor: C.line }}
        >
          <p className="font-display text-body" style={{ color: C.ink }}>
            <span className="font-medium">{ACTION_LABEL[entry.action]}</span>
            {entry.detail && <span style={{ color: C.sub }}> · {entry.detail}</span>}
          </p>
          {entry.note && (
            <p className="whitespace-pre-wrap font-display text-body" style={{ color: C.body }}>
              “{entry.note}”
            </p>
          )}
          <p className="font-display text-label" style={{ color: C.faint }}>
            {entry.actorName ?? 'Someone since removed'} · {fmtDateTime(entry.at) ?? '--'}
          </p>
        </li>
      ))}
    </ul>
  )
}
