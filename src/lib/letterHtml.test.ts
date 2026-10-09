import { describe, expect, it } from 'vitest'
import { letterHtml } from './letterHtml'
import { fitLogo, LOGO_MAX_HEIGHT, LOGO_MAX_WIDTH } from './logo'

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

describe('fitLogo', () => {
  it('fits a wordmark and a square inside the box at their own proportions', () => {
    expect(fitLogo(2000, 500)).toEqual({ width: LOGO_MAX_WIDTH, height: 120 })
    expect(fitLogo(1000, 1000)).toEqual({ width: LOGO_MAX_HEIGHT, height: LOGO_MAX_HEIGHT })
  })

  it('never enlarges a small logo', () => {
    expect(fitLogo(120, 40)).toEqual({ width: 120, height: 40 })
  })
})
