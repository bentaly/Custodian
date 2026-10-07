import { useLayoutEffect, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { LeftToRightListBulletIcon } from '@hugeicons/core-free-icons'
import { cn } from './cn'
import { C } from './tokens'
import { Textarea } from './fields'
import {
  continueBullets,
  parseBulletText,
  toggleBullets,
  type TextEdit,
} from '../../lib/bulletText'

/**
 * A `Textarea` that can hold a bulleted list: a list button in its corner, and Enter
 * continuing the list (or ending it, on an empty item). The value stays plain text,
 * "• " marking an item, so see `lib/bulletText.ts` for why. Read back with `BulletText`.
 */
export function BulletTextarea({
  value,
  onValueChange,
  className,
  disabled,
  onKeyDown,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  value: string
  onValueChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Where the caret goes once React has written an edit's value. Set in the same
  // commit, before the next keystroke can land: a frame later, fast typing went in at
  // the end of the box and scrambled the list.
  const pending = useRef<TextEdit | null>(null)
  useLayoutEffect(() => {
    const edit = pending.current
    const t = ref.current
    if (!edit || !t || t.value !== edit.value) return
    pending.current = null
    t.focus()
    t.setSelectionRange(edit.selectionStart, edit.selectionEnd)
  }, [value])

  const apply = (edit: TextEdit) => {
    pending.current = edit
    onValueChange(edit.value)
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing)
            return
          const t = e.currentTarget
          const edit = continueBullets(t.value, t.selectionStart, t.selectionEnd)
          if (!edit) return
          e.preventDefault()
          apply(edit)
        }}
        disabled={disabled}
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        aria-label="Bulleted list"
        title="Bulleted list"
        disabled={disabled}
        // Keep the textarea's selection: a mousedown on a button would blur it first.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const t = ref.current
          if (!t) return
          apply(toggleBullets(t.value, t.selectionStart, t.selectionEnd))
        }}
        className="absolute top-2 right-2 flex size-6 cursor-pointer items-center justify-center rounded-chip hover:bg-grey-200 focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-hidden disabled:cursor-default disabled:opacity-50"
        style={{ color: C.sub }}
      >
        <HugeiconsIcon icon={LeftToRightListBulletIcon} size={16} color="currentColor" />
      </button>
    </div>
  )
}

/** Plain text with `BulletTextarea`'s lists drawn as lists. */
export function BulletText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {parseBulletText(text).map((block, i) =>
        block.kind === 'list' ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {block.text}
          </p>
        ),
      )}
    </div>
  )
}
