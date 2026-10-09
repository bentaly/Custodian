import { describe, expect, it } from 'vitest'
import { letterHtml } from './letterHtml'
import { clampAxis, containScale } from './logo'

const logo = {
  url: 'https://custodian.fund/api/logo/abc?v=1',
  alt: 'The Montirex Foundation',
  width: 480,
  height: 120,
}

describe('letterHtml with a logo', () => {
  it('heads the letter with it, sized for the letter and named for a blocked image', () => {
    const html = letterHtml('Dear Sean’s Place,', logo)
    expect(html).toContain(
      '<img src="https://custodian.fund/api/logo/abc?v=1" alt="The Montirex Foundation" width="240" height="60"',
    )
    expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Dear'))
  })

  it('writes no image without one', () => {
    expect(letterHtml('Dear Sean’s Place,')).not.toContain('<img')
    expect(letterHtml('Dear Sean’s Place,', null)).not.toContain('<img')
  })

  // The address comes from our own server, but this is markup sent to third parties.
  it('escapes the name and refuses anything but a web address', () => {
    expect(letterHtml('x', { ...logo, alt: 'A "quoted" <b>name</b>' })).toContain(
      'alt="A &quot;quoted&quot; &lt;b&gt;name&lt;/b&gt;"',
    )
    expect(letterHtml('x', { ...logo, url: 'javascript:alert(1)' })).not.toContain('<img')
  })
})

describe('logo positioning', () => {
  it('starts with the whole logo inside the frame, at its own proportions', () => {
    expect(containScale(2000, 500, 360, 120)).toBeCloseTo(0.18) // a wordmark, width-bound
    expect(containScale(1000, 1000, 360, 120)).toBeCloseTo(0.12) // a square, height-bound
  })

  it('keeps a logo smaller than the frame wholly inside it', () => {
    expect(clampAxis(-10, 120, 360)).toBe(0)
    expect(clampAxis(300, 120, 360)).toBe(240)
    expect(clampAxis(100, 120, 360)).toBe(100)
  })

  it('keeps a zoomed logo covering the frame rather than pushed out of view', () => {
    expect(clampAxis(20, 500, 360)).toBe(0)
    expect(clampAxis(-200, 500, 360)).toBe(-140)
  })
})
