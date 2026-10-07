import { describe, it, expect } from 'vitest'
import { continueBullets, hasBullets, parseBulletText, toggleBullets } from './bulletText'

describe('parseBulletText', () => {
  it('reads paragraphs and lists, typed bullets included', () => {
    expect(
      parseBulletText('Two reasons:\n• cheaper venue\n- fewer sessions\n\nAgreed by the chair'),
    ).toEqual([
      { kind: 'paragraph', text: 'Two reasons:' },
      { kind: 'list', items: ['cheaper venue', 'fewer sessions'] },
      { kind: 'paragraph', text: 'Agreed by the chair' },
    ])
  })

  it('keeps a plain note as one paragraph, line breaks and all', () => {
    expect(parseBulletText('line one\nline two')).toEqual([
      { kind: 'paragraph', text: 'line one\nline two' },
    ])
    expect(hasBullets('line one\nline two')).toBe(false)
  })

  // A hyphen inside a sentence, or a negative figure, is not a list.
  it('needs the marker at the start of a line, followed by a space', () => {
    expect(hasBullets('cut by £2,000 - see notes')).toBe(false)
    expect(hasBullets('-2,000 on the venue')).toBe(false)
  })
})

describe('toggleBullets', () => {
  it('starts a list in an empty box', () => {
    expect(toggleBullets('', 0, 0)).toEqual({ value: '• ', selectionStart: 2, selectionEnd: 2 })
  })

  it('bullets every line the selection touches, and un-bullets them again', () => {
    const on = toggleBullets('a\nb\nc', 0, 3)
    expect(on.value).toBe('• a\n• b\nc')
    expect(toggleBullets(on.value, on.selectionStart, on.selectionEnd).value).toBe('a\nb\nc')
  })

  it('moves the caret with its line', () => {
    expect(toggleBullets('first\nsecond', 9, 9)).toEqual({
      value: 'first\n• second',
      selectionStart: 11,
      selectionEnd: 11,
    })
  })
})

describe('continueBullets', () => {
  it('continues a list on Enter', () => {
    expect(continueBullets('• one', 5, 5)).toEqual({
      value: '• one\n• ',
      selectionStart: 8,
      selectionEnd: 8,
    })
  })

  it('ends the list on an empty item', () => {
    expect(continueBullets('• one\n• ', 8, 8)).toEqual({
      value: '• one\n',
      selectionStart: 6,
      selectionEnd: 6,
    })
  })

  it('leaves Enter alone outside a list', () => {
    expect(continueBullets('plain', 5, 5)).toBeNull()
  })
})
