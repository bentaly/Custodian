import { describe, expect, it } from 'vitest'
import { resolveRemembered } from './useRemembered'

// The hook itself needs a DOM and this suite runs in node, so what is pinned here is
// the decode — which is where the one bug with teeth lives: a stored value that is
// neither of ours must fall back to the PANEL's default, not to false.
describe('resolveRemembered', () => {
  it('uses the stored answer over the default', () => {
    expect(resolveRemembered('1', false)).toBe(true)
    expect(resolveRemembered('0', true)).toBe(false)
  })

  it('falls back when nothing has been chosen', () => {
    expect(resolveRemembered(null, true)).toBe(true)
    expect(resolveRemembered(null, false)).toBe(false)
  })

  it('treats an unrecognised value as never chosen, not as false', () => {
    // A key left by an older shape of the module, or by another tab writing junk. A
    // default-open card must stay open rather than silently collapse.
    for (const junk of ['', 'true', 'false', '2', '{}']) {
      expect(resolveRemembered(junk, true)).toBe(true)
      expect(resolveRemembered(junk, false)).toBe(false)
    }
  })
})
