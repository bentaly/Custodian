import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'
import { C } from './ui/tokens'

// The app's one rich-text box — the programme goal, the giving strategy. There were two
// of these: this component, and a second copy inlined in `settings/giving-strategy` with
// heading buttons bolted on. They had already drifted (different toolbars, and both with
// a `bg-grey-800` active state, which is the charcoal the redesign moved off). The
// heading buttons are a prop now, so the strategy page can have them and a programme goal
// — three lines of prose — need not.
//
// The shell is the app's field: a 12px radius on the hairline, and the brand focus ring
// every other control wears. Not the wash surface `Input` uses, because this box is tall
// and contains formatted content: a filled block that size reads as a rendered panel
// rather than something you can type into.

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
      // mousedown, not click: the editor must not lose the selection the button acts on.
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className="rounded-chip px-2 py-1 font-display text-label font-medium transition-colors hover:bg-grey-100"
      style={active ? { backgroundColor: C.brandBg, color: C.brand } : { color: C.sub }}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}

function Separator() {
  return <span className="mx-1 border-l" style={{ borderColor: C.line }} />
}

function Headings({ editor }: { editor: Editor }) {
  return (
    <>
      <Separator />
      {([1, 2, 3] as const).map((level) => (
        <ToolbarButton
          key={level}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          active={editor.isActive('heading', { level })}
        >
          H{level}
        </ToolbarButton>
      ))}
    </>
  )
}

export function RichTextEditor({
  defaultValue = '',
  onChange,
  minHeight = '120px',
  headings = false,
}: {
  defaultValue?: string
  onChange?: (markdown: string) => void
  minHeight?: string
  /** Offers H1/H2/H3. For a long document, not a paragraph of guidance. */
  headings?: boolean
}) {
  const editor = useEditor({
    // StarterKit bundles Underline as of tiptap 3.x — adding the standalone
    // extension again triggers the duplicate-extension warning.
    extensions: [StarterKit, Markdown],
    content: defaultValue,
    editorProps: {
      attributes: {
        class: `px-3 py-2 font-display text-body text-grey-900 focus:outline-hidden prose prose-sm max-w-none`,
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
    <div
      className="rounded-control border focus-within:ring-2 focus-within:ring-brand/20"
      style={{ borderColor: C.line }}
    >
      <div
        className="flex flex-wrap gap-0.5 border-b px-2 py-1.5"
        style={{ borderColor: C.line, backgroundColor: C.wash }}
      >
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
        {headings && <Headings editor={editor} />}
        <Separator />
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
