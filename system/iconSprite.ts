/**
 * The icon sprite served at /icons.svg: one <symbol id="qt-i-{name}"> per
 * name in system/iconGlyphs.ts, drawn the way the icons were drawn inline
 * (stroke 1.5, currentColor). `Icon` draws `<use href>` into it, so the
 * colour follows the text around the icon.
 *
 * ICON_SPRITE_VERSION (system/iconSpriteVersion.ts) is the sprite's hash;
 * the address carries it, so the sprite can be cached for good and a change
 * of drawing is a new address. A unit test keeps the two in step.
 */
import { createHash } from 'node:crypto'
import { ICON_GLYPHS, type IconDrawing } from './iconGlyphs'

const STROKE_WIDTH = 1.5

const attrName = (key: string) =>
  key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

function drawing(parts: IconDrawing): string {
  return parts
    .map(([tag, attrs]) => {
      const all: Record<string, string | number> = {
        ...attrs,
        strokeWidth: STROKE_WIDTH,
        stroke: 'currentColor',
      }
      const list = Object.entries(all)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${attrName(key)}="${escape(String(value))}"`)
        .join(' ')
      return `<${tag} ${list}/>`
    })
    .join('')
}

export function buildIconSprite(): string {
  const symbols = Object.entries(ICON_GLYPHS)
    .map(
      ([name, parts]) =>
        `<symbol id="qt-i-${name}" viewBox="0 0 24 24" fill="none">${drawing(parts)}</symbol>`
    )
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`
}

export function iconSpriteHash(sprite = buildIconSprite()): string {
  return createHash('sha256').update(sprite).digest('hex').slice(0, 10)
}
