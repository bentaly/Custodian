import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

function ToolbarButton({
  onClick,
  active,
  children,
}: {
  onClick: () => void
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className={`rounded-chip px-2 py-1 text-label font-medium transition-colors ${
        active ? 'bg-grey-800 text-white' : 'text-grey-600 hover:bg-grey-100'
      }`}
    >
      {children}
    </button>
  )
}

export function RichTextEditor({
  defaultValue = '',
  onChange,
  minHeight = '120px',
}: {
  defaultValue?: string
  onChange?: (markdown: string) => void
  minHeight?: string
}) {
  const editor = useEditor({
    // StarterKit bundles Underline as of tiptap 3.x — adding the standalone
    // extension again triggers the duplicate-extension warning.
    extensions: [StarterKit, Markdown],
    content: defaultValue,
    editorProps: {
      attributes: {
        class: `px-3 py-2 text-body text-grey-900 focus:outline-hidden prose prose-sm max-w-none`,
        style: `min-height: ${minHeight}`,
      },
    },
    onUpdate: ({ editor }) => {
      if (onChange) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const md = (editor.storage as any).markdown.getMarkdown() as string
        onChange(md)
      }
    },
  })

  if (!editor) return null

  return (
    <div className="rounded-chip border border-grey-300 focus-within:ring-2 focus-within:ring-grey-400">
      <div className="flex flex-wrap gap-0.5 border-b border-grey-200 bg-grey-50 px-2 py-1.5">
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
        <span className="mx-1 border-l border-grey-200" />
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
  )
}
