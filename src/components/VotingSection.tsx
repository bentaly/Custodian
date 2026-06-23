import { useState, useEffect, useCallback } from 'react'
import { listVotes, castVote } from '../server/fns/comments'

type VoteData = {
  trustees: Array<{ id: string; name: string }>
  votes: Array<{ userId: string; vote: 'yes' | 'no'; createdAt: Date }>
  allowAdminVoting: boolean
}

export function VotingSection({
  applicationId,
  userId,
  userRole,
}: {
  applicationId: string
  userId: string
  userRole: string
}) {
  const [data, setData] = useState<VoteData | null>(null)
  const [voting, setVoting] = useState(false)
  const isTrustee = userRole === 'trustee'
  const isAdmin = userRole === 'admin' || userRole === 'superadmin'

  const load = useCallback(async () => {
    const result = await listVotes({ data: { applicationId } })
    setData(result as VoteData)
  }, [applicationId])

  useEffect(() => {
    load()
  }, [load])

  // Trustees vote as themselves (onBehalfOf omitted); admins record a vote for a
  // specific trustee when the organisation has enabled admin voting.
  async function handleVote(vote: 'yes' | 'no', onBehalfOf?: string) {
    setVoting(true)
    try {
      await castVote({ data: { applicationId, vote, onBehalfOf } })
      await load()
    } finally {
      setVoting(false)
    }
  }

  if (!data) return null
  if (data.trustees.length === 0) return null

  const voteMap = new Map(data.votes.map((v) => [v.userId, v.vote]))
  const yesCount = data.votes.filter((v) => v.vote === 'yes').length
  const noCount = data.votes.filter((v) => v.vote === 'no').length
  const canAdminVote = isAdmin && data.allowAdminVoting

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          Trustee votes
        </h3>
        {data.votes.length > 0 && (
          <div className="flex gap-2 text-xs">
            <span className="font-semibold text-emerald-700">{yesCount} yes</span>
            <span className="text-gray-300">·</span>
            <span className="font-semibold text-red-600">{noCount} no</span>
          </div>
        )}
      </div>

      {canAdminVote && (
        <p className="mb-2 text-xs text-gray-400">You can record votes on behalf of trustees.</p>
      )}

      <div className="overflow-hidden rounded-lg border border-gray-100">
        {data.trustees.map((trustee, i) => {
          const vote = voteMap.get(trustee.id)
          const isMe = trustee.id === userId
          // The current trustee votes for themselves; an admin (when enabled) may
          // record a vote for any trustee.
          const canSetThisVote = (isMe && isTrustee) || canAdminVote
          return (
            <div
              key={trustee.id}
              className={`flex items-center justify-between px-3 py-2.5 ${
                i < data.trustees.length - 1 ? 'border-b border-gray-100' : ''
              }`}
            >
              <span className="text-sm text-gray-700">
                {trustee.name}
                {isMe && (
                  <span className="ml-1 text-xs text-gray-400">(you)</span>
                )}
              </span>

              {canSetThisVote ? (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleVote('yes', isMe ? undefined : trustee.id)}
                    disabled={voting}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      vote === 'yes'
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border border-gray-200 text-gray-500 hover:border-emerald-200 hover:text-emerald-700'
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => handleVote('no', isMe ? undefined : trustee.id)}
                    disabled={voting}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      vote === 'no'
                        ? 'border border-red-200 bg-red-50 text-red-600'
                        : 'border border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-600'
                    }`}
                  >
                    No
                  </button>
                </div>
              ) : vote ? (
                <span
                  className={`text-xs font-medium ${
                    vote === 'yes' ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {vote === 'yes' ? '✓ Yes' : '✗ No'}
                </span>
              ) : (
                <span className="text-xs text-gray-300">—</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
