import { useState, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Markdown } from 'tiptap-markdown'
import { authClient } from '../../lib/auth-client'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'

export const Route = createFileRoute('/_authenticated/profile')({
  loader: async () => {
    const profile = await getClientProfile()
    return { profile }
  },
  component: Profile,
})

const ROLE_LABELS: Record<string, string> = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  contributor: 'Contributor',
  observer: 'Observer',
  trustee: 'Trustee',
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      disabled={disabled}
      className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-gray-800 text-white'
          : 'text-gray-600 hover:bg-gray-100 disabled:opacity-40'
      }`}
    >
      {children}
    </button>
  )
}

function MissionStatementEditor({ initialContent }: { initialContent: string }) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const editor = useEditor({
    extensions: [StarterKit, Underline, Markdown],
    content: initialContent || '',
    editorProps: {
      attributes: {
        class:
          'min-h-[160px] px-3 py-2 text-sm text-gray-900 focus:outline-none prose prose-sm max-w-none',
      },
    },
  })

  const handleSave = useCallback(async () => {
    if (!editor) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markdown = (editor.storage as any).markdown.getMarkdown() as string
      await upsertClientProfile({ data: { missionStatement: markdown } })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }, [editor])

  if (!editor) return null

  return (
    <div>
      <div className="rounded border border-gray-300 focus-within:ring-2 focus-within:ring-gray-400">
        <div className="flex flex-wrap gap-0.5 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
          >
            B
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive('underline')}
          >
            <span className="underline">U</span>
          </ToolbarButton>
          <span className="mx-1 border-l border-gray-200" />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            active={editor.isActive('heading', { level: 1 })}
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            active={editor.isActive('heading', { level: 2 })}
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            active={editor.isActive('heading', { level: 3 })}
          >
            H3
          </ToolbarButton>
          <span className="mx-1 border-l border-gray-200" />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
          >
            • List
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
          >
            1. List
          </ToolbarButton>
        </div>
        <EditorContent editor={editor} />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-3 rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}

function Profile() {
  const { user } = Route.useRouteContext()
  const { profile } = Route.useLoaderData()
  const [name, setName] = useState(user.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const isAdmin = user.role === 'admin' || user.role === 'superadmin'

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (name === user.name) return
    setSaving(true)
    setError('')
    setSaved(false)

    const { error: updateError } = await authClient.updateUser({ name })
    setSaving(false)
    if (updateError) {
      setError(updateError.message ?? 'Failed to update name')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold text-gray-900">Profile</h1>
      <p className="mt-1 text-sm text-gray-500">Your account details</p>

      <div className="mt-8 space-y-6">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={user.email}
              readOnly
              className="mt-1 w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 cursor-not-allowed"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={saving || name === user.name}
            className="rounded bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
          </button>
        </form>

        <div className="border-t border-gray-100 pt-6 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Role</span>
            <span className="font-medium text-gray-800">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
        </div>

        {isAdmin && user.clientId && (
          <div className="border-t border-gray-100 pt-6 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Mission statement</h2>
              <p className="mt-0.5 text-sm text-gray-500">
                Describe your organisation's goals and funding priorities. This will be used to
                score incoming applications.
              </p>
            </div>
            <MissionStatementEditor initialContent={profile?.missionStatement ?? ''} />
          </div>
        )}
      </div>
    </div>
  )
}
