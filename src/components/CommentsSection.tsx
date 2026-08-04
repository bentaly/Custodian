import { useState, useEffect, useCallback } from 'react'
import { listComments, addComment, updateComment, deleteComment } from '../server/fns/comments'
import { fmtSince } from '../lib/format'

// Figma node 435:42458 — the full-width comment panel on the application detail
// screen: composer on top, then every comment as a moss-washed card with the author
// left and its age right. Deliberately unpaginated; a board's discussion of one
// application is short, and paging it hid the thread behind a control.

type Comment = {
  id: string
  body: string
  createdAt: string | Date
  updatedAt?: string | Date | null
  user: { id: string; name: string; role: string }
}

const C = {
  ink: '#141C24',
  sub: '#637083',
  faint: '#97A1AF',
  line: '#E4E7EC',
  brand: '#1F7A5C',
  brandBg: 'rgba(31, 122, 92, 0.1)',
  brandBorder: 'rgba(31, 122, 92, 0.2)',
  cardBg: 'rgba(31, 122, 92, 0.05)',
  danger: '#FF4242',
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
}: {
  applicationId: string
  userId: string
  userRole: string
}) {
  const [comments, setComments] = useState<Comment[]>([])
  const [loading, setLoading] = useState(true)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const canComment = CAN_COMMENT.has(userRole)
  const isAdmin = userRole === 'superadmin' || userRole === 'admin'

  const load = useCallback(async () => {
    const data = await listComments({ data: { applicationId } })
    setComments(data as Comment[])
    setLoading(false)
  }, [applicationId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return
    setSubmitting(true)
    try {
      await addComment({ data: { applicationId, body: body.trim() } })
      setBody('')
      await load()
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
    try {
      await updateComment({ data: { id, body: editBody.trim() } })
      setEditingId(null)
      setEditBody('')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this comment?')) return
    setBusyId(id)
    try {
      await deleteComment({ data: { id } })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[16px] font-medium" style={{ color: C.ink }}>
          Comments
        </h2>
        {!loading && comments.length > 0 && (
          <span className="font-display text-[12px]" style={{ color: C.sub }}>
            {comments.length} comment{comments.length !== 1 ? 's' : ''} in total
          </span>
        )}
      </div>

      {canComment && (
        <form onSubmit={handleSubmit} className="flex flex-col items-start gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a comment for the panel…"
            className="h-[120px] w-full resize-none rounded-[12px] border bg-white px-3 py-2 font-display text-[14px] focus:outline-hidden"
            style={{ borderColor: C.line, color: C.ink }}
          />
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="flex h-10 items-center justify-center rounded-[12px] border px-3 font-display text-[14px] font-medium disabled:opacity-50"
            style={{
              backgroundColor: C.brandBg,
              borderColor: C.brandBorder,
              color: C.brand,
            }}
          >
            {submitting ? 'Posting…' : 'Post comment'}
          </button>
        </form>
      )}

      {loading ? (
        <p className="font-display text-[13px]" style={{ color: C.faint }}>
          Loading…
        </p>
      ) : comments.length === 0 ? (
        <p className="font-display text-[13px]" style={{ color: C.faint }}>
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
                className="flex flex-col gap-2 rounded-lg p-4"
                style={{ backgroundColor: C.cardBg }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 font-display text-[12px]">
                    <span className="font-medium" style={{ color: C.ink }}>
                      {c.user.name}
                    </span>
                    <span style={{ color: C.faint }}>{roleLabel(c.user.role)}</span>
                  </span>
                  <span className="font-display text-[12px]" style={{ color: C.sub }}>
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
                      className="w-full resize-none rounded-lg border bg-white px-3 py-2 font-display text-[12px] focus:outline-hidden"
                      style={{ borderColor: C.line, color: C.ink }}
                    />
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={busy}
                        className="font-display text-[12px] font-medium disabled:opacity-50"
                        style={{ color: C.sub }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(c.id)}
                        disabled={busy || !editBody.trim()}
                        className="font-display text-[12px] font-medium disabled:opacity-50"
                        style={{ color: C.brand }}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      className="whitespace-pre-wrap font-display text-[12px] leading-relaxed"
                      style={{ color: C.sub }}
                    >
                      {c.body}
                    </p>
                    {(canEdit || canDelete) && (
                      <div className="flex gap-3">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => startEdit(c)}
                            disabled={busy}
                            className="font-display text-[11px] font-medium disabled:opacity-50"
                            style={{ color: C.faint }}
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => handleDelete(c.id)}
                            disabled={busy}
                            className="font-display text-[11px] font-medium disabled:opacity-50"
                            style={{ color: busy ? C.danger : C.faint }}
                          >
                            {busy ? 'Deleting…' : 'Delete'}
                          </button>
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
    </div>
  )
}
