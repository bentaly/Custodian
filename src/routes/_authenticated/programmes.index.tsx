import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { listProgrammes, createProgramme, listClientTags } from '../../server/fns/programmes'
import { TagInput } from '../../components/TagInput'
import { RichTextEditor } from '../../components/RichTextEditor'

export const Route = createFileRoute('/_authenticated/programmes/')({
  loader: async () => {
    const [programmes, clientTags] = await Promise.all([listProgrammes(), listClientTags()])
    return { programmes, clientTags }
  },
  component: Programmes,
})

const PROG_STATUS_LABELS = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
}

const PROG_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-500',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-red-100 text-red-600',
}

function Programmes() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const { programmes, clientTags } = Route.useLoaderData()
  const canManage = ['superadmin', 'admin'].includes(user.role)

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [goal, setGoal] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!user.clientId) return
    setError('')
    setCreating(true)
    try {
      const programme = await createProgramme({
        data: {
          clientId: user.clientId,
          name,
          description: description || undefined,
          goal: goal || undefined,
          tags,
        },
      })
      router.navigate({ to: '/programmes/$programmeId', params: { programmeId: programme.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create programme')
      setCreating(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Programmes</h1>
          <p className="mt-1 text-sm text-gray-500">
            Define giving programmes and add them to funding rounds
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800"
          >
            New programme
          </button>
        )}
      </div>

      {showCreate && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-sm font-medium text-gray-700">Create programme</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Community Arts Fund"
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Description <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Themes</label>
              <TagInput value={tags} onChange={setTags} suggestions={clientTags} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Goal{' '}
                <span className="font-normal text-gray-400">— used by AI to score applications</span>
              </label>
              <RichTextEditor key="create" defaultValue={goal} onChange={setGoal} />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create programme'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {programmes.length === 0 && !showCreate ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-gray-500">No programmes yet.</p>
          {canManage && (
            <p className="mt-1 text-sm text-gray-400">Create your first programme to get started.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {programmes.map((programme) => {
            const progTags = (programme.tags ?? []) as string[]
            return (
              <Link
                key={programme.id}
                to="/programmes/$programmeId"
                params={{ programmeId: programme.id }}
                className="block rounded-lg border border-gray-200 bg-white px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{programme.name}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${PROG_STATUS_COLORS[programme.status]}`}
                      >
                        {PROG_STATUS_LABELS[programme.status]}
                      </span>
                    </div>
                    {progTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {progTags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-600"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-gray-400">
                      {programme.applications.length}{' '}
                      {programme.applications.length === 1 ? 'application' : 'applications'}
                    </div>
                  </div>
                  <span className="text-xs text-gray-400">→</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
