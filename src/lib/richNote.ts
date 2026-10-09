/**
 * A short formatted note, as the compact `RichTextEditor` writes it: paragraphs, bullet
 * and numbered lists, bold, italic and underline. Read here for display, by a parser
 * that knows exactly that much and nothing more, so a note is never put on a page as
 * HTML: every piece comes back as text with a flag or two, and React escapes it.
 *
 * Stored as the editor's Markdown (`**bold**`, `*italic*`, `<u>underline</u>`, `- item`,
 * `1. item`). Notes written before the editor were plain text whose lists started "• ",
 * and they read exactly as they did: "•", "-" and "*" all open a bullet, which is also
 * how people type a list into a box that offers none.
 *
 * Today that is the reason given with a proposed amount (`AmountDialog`), shown whole
 * on an application's Activity tab and clipped to one line in Settings → Activity.
 */

export type InlineSpan = { text: string; bold?: boolean; italic?: boolean; underline?: boolean }

export type NoteBlock =
  | { kind: 'paragraph'; spans: InlineSpan[] }
  | { kind: 'list'; ordered: boolean; items: InlineSpan[][] }

const BULLET = /^\s*[•\-*]\s+/
const NUMBERED = /^\s*\d+[.)]\s+/

// Markdown's backslash escapes (`\*` is a literal asterisk), parked on private-use
// characters while the marks are matched so an escaped marker can never pair up.
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!<>|~])/g
const PARK = 0xe000
const park = (s: string) =>
  s.replace(ESCAPE, (_, c: string) => String.fromCharCode(PARK + c.charCodeAt(0)))
const unpark = (s: string) =>
  s.replace(/[-]/g, (c) => String.fromCharCode(c.charCodeAt(0) - PARK))

type Mark = 'bold' | 'italic' | 'underline'

// Strongest first, so `**` is never read as two italics. A marker must hug its text
// ("5 * 3 * 2" is arithmetic, not italics), and an underscore must not sit inside a
// word ("snake_case_name").
const MARKS: Array<{ re: RegExp; mark: Mark }> = [
  { re: /\*\*(?!\s)([\s\S]+?)(?<!\s)\*\*/, mark: 'bold' },
  { re: /__(?!\s)([\s\S]+?)(?<!\s)__/, mark: 'bold' },
  { re: /<u>([\s\S]+?)<\/u>/, mark: 'underline' },
  { re: /\*(?!\s)([\s\S]+?)(?<!\s)\*/, mark: 'italic' },
  { re: /(?<![\p{L}\p{N}])_(?!\s)([\s\S]+?)(?<!\s)_(?![\p{L}\p{N}])/u, mark: 'italic' },
]

function spans(text: string, on: Omit<InlineSpan, 'text'>): InlineSpan[] {
  let first: { at: number; length: number; inner: string; mark: Mark } | null = null
  for (const { re, mark } of MARKS) {
    const m = re.exec(text)
    if (m && (first === null || m.index < first.at)) {
      first = { at: m.index, length: m[0].length, inner: m[1]!, mark }
    }
  }
  if (!first) return text ? [{ text: unpark(text), ...on }] : []
  return [
    ...spans(text.slice(0, first.at), on),
    ...spans(first.inner, { ...on, [first.mark]: true }),
    ...spans(text.slice(first.at + first.length), on),
  ]
}

/** One line or paragraph's bold, italic and underline. */
export function parseInline(text: string): InlineSpan[] {
  return spans(park(text), {})
}

/** The note as paragraphs and lists. Blank lines separate paragraphs. */
export function parseNote(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', spans: parseInline(para.join('\n')) })
    para = []
  }
  for (const line of text.split('\n')) {
    const marker = line.match(BULLET) ?? line.match(NUMBERED)
    if (marker) {
      flush()
      const ordered = !BULLET.test(line)
      const item = parseInline(line.slice(marker[0].length))
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item)
      else blocks.push({ kind: 'list', ordered, items: [item] })
    } else if (line.trim() === '') {
      flush()
    } else {
      para.push(line)
    }
  }
  flush()
  return blocks
}

/** True when the note is one paragraph, which is the case worth quoting. */
export function isSingleParagraph(text: string): boolean {
  const blocks = parseNote(text)
  return blocks.length === 1 && blocks[0]!.kind === 'paragraph'
}

/** The note as one line of plain text, for a table cell: marks gone, items "• ". */
export function noteAsPlainText(text: string): string {
  const flat = (s: InlineSpan[]) => s.map((x) => x.text).join('')
  return parseNote(text)
    .flatMap((b) =>
      b.kind === 'paragraph'
        ? [flat(b.spans)]
        : b.items.map((item, i) => `${b.ordered ? `${i + 1}.` : '•'} ${flat(item)}`),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
