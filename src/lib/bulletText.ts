/**
 * Bulleted lists in plain text: the one bit of formatting a reason box offers.
 *
 * Stored as plain text, a line starting "• " being a list item, so nothing that reads
 * the column needs to know (the Settings activity table prints it on one line, a CSV
 * export carries it as typed). There is deliberately no markup passthrough: "- " and
 * "* " are READ as bullets too, because that is how people type a list into a box
 * that offers none, but the button only ever writes "• ".
 *
 * The editing half works on a textarea's value and selection and returns the new
 * value and caret, so it can be tested without a DOM.
 */

export const BULLET = '• '

const ITEM = /^\s*[•\-*]\s+/

export type TextBlock = { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] }

/** The text as paragraphs and lists, for display. Blank lines separate paragraphs. */
export function parseBulletText(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'paragraph', text: para.join('\n') })
    para = []
  }
  for (const line of text.split('\n')) {
    if (ITEM.test(line)) {
      flush()
      const item = line.replace(ITEM, '')
      const last = blocks[blocks.length - 1]
      if (last?.kind === 'list') last.items.push(item)
      else blocks.push({ kind: 'list', items: [item] })
    } else if (line.trim() === '') {
      flush()
    } else {
      para.push(line)
    }
  }
  flush()
  return blocks
}

export function hasBullets(text: string): boolean {
  return text.split('\n').some((line) => ITEM.test(line))
}

export interface TextEdit {
  value: string
  selectionStart: number
  selectionEnd: number
}

function lineStart(value: string, at: number): number {
  return value.lastIndexOf('\n', at - 1) + 1
}

function lineEnd(value: string, at: number): number {
  const end = value.indexOf('\n', at)
  return end === -1 ? value.length : end
}

/**
 * The bullet button: turns the lines the selection touches into list items, or back
 * into plain lines when every one of them already is. An empty box gets a first "• ".
 */
export function toggleBullets(value: string, start: number, end: number): TextEdit {
  const from = lineStart(value, start)
  const to = lineEnd(value, end)
  const lines = value.slice(from, to).split('\n')
  const allBulleted = lines.every((l) => ITEM.test(l))
  const next = lines.map((l) => (allBulleted ? l.replace(ITEM, '') : BULLET + l.replace(ITEM, '')))
  const replaced = next.join('\n')
  const out = value.slice(0, from) + replaced + value.slice(to)
  // A caret touches one line, and moves by however much that line grew or shrank; a
  // selection covers the edited lines.
  if (start === end) {
    const at = Math.max(from, start + replaced.length - (to - from))
    return { value: out, selectionStart: at, selectionEnd: at }
  }
  return { value: out, selectionStart: from, selectionEnd: from + replaced.length }
}

/**
 * Enter inside a list: continue it with a new "• ", or, pressed on an empty item,
 * end it (the marker goes and the caret stays on that now-blank line), the way every
 * word processor behaves. Null means "not in a list, let the browser have the key".
 */
export function continueBullets(value: string, start: number, end: number): TextEdit | null {
  const from = lineStart(value, start)
  const line = value.slice(from, lineEnd(value, start))
  const marker = line.match(ITEM)
  if (!marker) return null
  if (line.trim() === line.slice(0, marker[0].length).trim() && start === end) {
    // An empty item: end the list here.
    const out = value.slice(0, from) + value.slice(from + line.length)
    return { value: out, selectionStart: from, selectionEnd: from }
  }
  const insert = '\n' + BULLET
  const out = value.slice(0, start) + insert + value.slice(end)
  const at = start + insert.length
  return { value: out, selectionStart: at, selectionEnd: at }
}
