import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Avatar } from '@/system/components/Avatar'

const draw = (src: string | null) =>
  renderToStaticMarkup(createElement(Avatar, { name: 'Lena Park', src }))

describe('Avatar', () => {
  it('draws an allowed image with no referrer', () => {
    const html = draw('/images/quilltip-logo.png')
    expect(html).toContain('src="/images/quilltip-logo.png"')
    expect(html).toContain('referrerPolicy="no-referrer"')
  })

  it('draws initials for any other address', () => {
    for (const src of [
      'https://evil.example/p.png',
      '/_next/image?url=https%3A%2F%2Fevil.example%2Fp.png&w=64&q=75',
      null,
    ]) {
      const html = draw(src)
      expect(html, String(src)).not.toContain('<img')
      expect(html, String(src)).toContain('>LP<')
    }
  })
})
