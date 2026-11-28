import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import * as icons from '@/system/icons'
import { ICON_GLYPHS } from '@/system/iconGlyphs'
import { buildIconSprite, iconSpriteHash } from '@/system/iconSprite'
import {
  ICON_SPRITE_URL,
  ICON_SPRITE_VERSION,
} from '@/system/iconSpriteVersion'
import { Icon } from '@/system/components/Icon'

const sprite = buildIconSprite()
const symbol = (name: string) =>
  sprite.match(new RegExp(`<symbol id="qt-i-${name}"[^>]*>(.*?)</symbol>`))

describe('the icon sprite', () => {
  it('has a symbol for every name in the vocabulary, once', () => {
    for (const name of Object.values(icons)) expect(symbol(name)).not.toBeNull()
    const ids = [...sprite.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(Object.keys(ICON_GLYPHS).length)
  })

  it('draws each icon as the inline icon drew it', () => {
    for (const [name, glyph] of Object.entries(ICON_GLYPHS)) {
      const inline = renderToStaticMarkup(
        createElement(HugeiconsIcon, {
          icon: glyph,
          strokeWidth: 1.5,
          color: 'currentColor',
        })
      )
      const inner = inline.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
      // Same shapes and attributes, whatever their order.
      const parts = (s: string) =>
        [...s.matchAll(/<(\w+) ([^>]*?)\/?>/g)].map(
          ([, tag, attrs = '']) =>
            `${tag} ${attrs
              .split(/(?<=") /)
              .sort()
              .join(' ')}`
        )
      expect(parts(inner).length, name).toBeGreaterThan(0)
      expect(parts(symbol(name)?.[1] ?? ''), name).toEqual(parts(inner))
    }
  })

  it('is addressed by its own hash, so a cached copy is never stale', () => {
    // When a drawing changes, set ICON_SPRITE_VERSION in
    // system/iconSpriteVersion.ts to the value this prints.
    expect(ICON_SPRITE_VERSION).toBe(iconSpriteHash(sprite))
    expect(ICON_SPRITE_URL).toBe(`/icons.svg?v=${ICON_SPRITE_VERSION}`)
  })

  it('an icon is a sized box with one reference: nothing moves when the sprite arrives', () => {
    const html = renderToStaticMarkup(
      createElement(Icon, { icon: icons.CloseIcon, size: 20 })
    )
    expect(html).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><use href="${ICON_SPRITE_URL}#qt-i-close"></use></svg>`
    )
    const labelled = renderToStaticMarkup(
      createElement(Icon, { icon: icons.InfoIcon, label: 'Note' })
    )
    expect(labelled).toContain('role="img"')
    expect(labelled).toContain('aria-label="Note"')
    expect(labelled).not.toContain('aria-hidden')
  })
})
