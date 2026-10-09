import { parseNote, type InlineSpan } from '../../lib/richNote'
import { cn } from './cn'

function Spans({ spans }: { spans: InlineSpan[] }) {
  return (
    <>
      {spans.map((s, i) => (
        <span
          key={i}
          className={cn(
            s.bold && 'font-semibold',
            s.italic && 'italic',
            s.underline && 'underline',
          )}
        >
          {s.text}
        </span>
      ))}
    </>
  )
}

function List({ ordered, items }: { ordered: boolean; items: InlineSpan[][] }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={cn(ordered ? 'list-decimal' : 'list-disc', 'space-y-0.5 pl-5')}>
      {items.map((item, j) => (
        <li key={j}>
          <Spans spans={item} />
        </li>
      ))}
    </Tag>
  )
}

/**
 * A note from the compact `RichTextEditor`, drawn: paragraphs, lists, bold, italic and
 * underline. Text only, never HTML; see `lib/richNote`. `quoted` wraps a one-paragraph
 * note in quotation marks, which a list in quotes would read as a typo.
 */
export function RichNote({
  text,
  quoted = false,
  className,
}: {
  text: string
  quoted?: boolean
  className?: string
}) {
  const blocks = parseNote(text)
  const quote = quoted && blocks.length === 1 && blocks[0]!.kind === 'paragraph'
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {blocks.map((block, i) =>
        block.kind === 'list' ? (
          <List key={i} ordered={block.ordered} items={block.items} />
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {quote && '“'}
            <Spans spans={block.spans} />
            {quote && '”'}
          </p>
        ),
      )}
    </div>
  )
}
