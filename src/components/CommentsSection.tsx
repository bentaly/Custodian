import { useState, useEffect, useCallback } from 'react'
import { listComments, addComment, updateComment, deleteComment } from '../server/fns/comments'

type Comment = {
  id: string
  body: string
  createdAt: string | Date
  updatedAt?: string | Date | null
  user: { id: string; name: string; role: string }
}

const CAN_COMMENT = new Set(['superadmin', 'admin', 'manager', 'trustee', 'finance'])

function roleLabel(role: string) {
  switch (role) {
    case 'admin': return 'Admin'
    case 'trustee': return 'Trustee'
    case 'finance': return 'Finance'
    default: return role
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
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Comments
      </h3>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-2.5">
          {comments.length === 0 && (
            <p className="text-sm text-gray-400">No comments yet.</p>
          )}

          {comments.map((c) => {
            const canEdit = c.user.id === userId
            const canDelete = c.user.id === userId || isAdmin
            const isEditing = editingId === c.id
            const busy = busyId === c.id
            return (
              <div
                key={c.id}
                className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2.5"
              >
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-xs font-medium text-gray-800">{c.user.name}</span>
                  <span
                    style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#f0f0ec', color: '#777' }}
                  >
                    {roleLabel(c.user.role)}
                  </span>
                  <span className="ml-auto text-[10px] text-gray-400">
                    {new Date(c.createdAt).toLocaleString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {c.updatedAt && ' · edited'}
                  </span>
                </div>

                {isEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={busy}
                        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSaveEdit(c.id)}
                        disabled={busy || !editBody.trim()}
                        className="rounded border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{c.body}</p>
                    {(canEdit || canDelete) && (
                      <div className="mt-1.5 flex gap-3">
                        {canEdit && (
                          <button
                            onClick={() => startEdit(c)}
                            disabled={busy}
                            className="text-[11px] font-medium text-gray-400 hover:text-gray-600 disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => handleDelete(c.id)}
                            disabled={busy}
                            className="text-[11px] font-medium text-gray-400 hover:text-red-600 disabled:opacity-50"
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

          {canComment && (
            <form onSubmit={handleSubmit} className="mt-1 space-y-2">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Add a comment…"
                rows={2}
                className="w-full resize-none rounded border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-gray-400 focus:outline-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !body.trim()}
                  className="rounded border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {submitting ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
