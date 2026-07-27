import { useState, useCallback } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { getClientProfile, upsertClientProfile } from '../../server/fns/clients'
import { Button } from '../../components/ui'
import { SettingsPage } from '../../components/SettingsPage'

export const Route = createFileRoute('/_authenticated/settings/giving-strategy')({
  beforeLoad: ({ context }) => {
    const isAdmin = context.user.role === 'admin' || context.user.role === 'superadmin'
    if (!isAdmin) throw redirect({ to: '/settings' })
  },
  loader: async () => ({ profile: await getClientProfile() }),
  component: GivingStrategy,
})

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
        active ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100 disabled:opacity-40'
      }`}
    >
      {children}
    </button>
  )
}

function GivingStrategy() {
  const { profile } = Route.useLoaderData()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const editor = useEditor({
    // StarterKit bundles Underline as of tiptap 3.x.
    extensions: [StarterKit, Markdown],
    content: profile?.missionStatement ?? '',
    editorProps: {
      attributes: {
        class:
          'min-h-[240px] px-3 py-2 text-sm text-gray-900 focus:outline-hidden prose prose-sm max-w-none',
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

  return (
    <SettingsPage
      title="Giving strategy"
      description="Describe your organisation's goals and funding priorities. Every incoming application is scored against what you write here, so be specific about what you will and won't fund."
    >
      {editor && (
        <div>
          <div className="rounded-sm border border-gray-300 focus-within:ring-2 focus-within:ring-gray-400">
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
          <Button onClick={handleSave} disabled={saving} className="mt-3">
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      )}
    </SettingsPage>
  )
}
