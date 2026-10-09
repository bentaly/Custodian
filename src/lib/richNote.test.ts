import { describe, expect, it } from 'vitest'
import { noteAsPlainText, parseInline, parseNote } from './richNote'

describe('parseNote', () => {
  it('still reads a reason written before the editor, "•" lists and all', () => {
    expect(
      parseNote('Two reasons:\n• cheaper venue\n- fewer sessions\n\nAgreed by the chair'),
    ).toEqual([
      { kind: 'paragraph', spans: [{ text: 'Two reasons:' }] },
      {
        kind: 'list',
        ordered: false,
        items: [[{ text: 'cheaper venue' }], [{ text: 'fewer sessions' }]],
      },
      { kind: 'paragraph', spans: [{ text: 'Agreed by the chair' }] },
    ])
  })

  it('reads the editor’s numbered lists apart from its bullets', () => {
    const blocks = parseNote('1. venue\n2. coaches\n\n- kit')
    expect(blocks.map((b) => b.kind === 'list' && b.ordered)).toEqual([true, false])
  })

  // A hyphen inside a sentence, or a negative figure, is not a list.
  it('needs the marker at the start of a line, followed by a space', () => {
    expect(parseNote('cut by £2,000 - see notes')[0]!.kind).toBe('paragraph')
    expect(parseNote('-2,000 on the venue')[0]!.kind).toBe('paragraph')
  })
})

describe('parseInline', () => {
  it('reads bold, italic and underline, nested too', () => {
    expect(parseInline('**cut** by *a third*, <u>agreed **twice**</u>')).toEqual([
      { text: 'cut', bold: true },
      { text: ' by ' },
      { text: 'a third', italic: true },
      { text: ', ' },
      { text: 'agreed ', underline: true },
      { text: 'twice', underline: true, bold: true },
    ])
  })

  it('leaves arithmetic, snake_case and escaped markers alone', () => {
    expect(parseInline('5 * 3 * 2')).toEqual([{ text: '5 * 3 * 2' }])
    expect(parseInline('see snake_case_name')).toEqual([{ text: 'see snake_case_name' }])
    expect(parseInline('\\*not italic\\*')).toEqual([{ text: '*not italic*' }])
  })

  it('never passes HTML through: any other tag is text', () => {
    expect(parseInline('<b>hi</b><script>x</script>')).toEqual([
      { text: '<b>hi</b><script>x</script>' },
    ])
  })
})

describe('noteAsPlainText', () => {
  it('flattens a note to one line for a table cell', () => {
    expect(noteAsPlainText('**Cut** because:\n- venue\n- kit')).toBe('Cut because: • venue • kit')
  })
})
