import { expect, test } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * No UI text holds a character that iPhone may draw as a colour emoji when
 * the page font lacks it (#666): a character with an emoji form that is text
 * by default (Emoji=Yes, Emoji_Presentation=No), such as the arrows ↗ and ↔.
 * Use an icon (components/ui/NorthEastArrow.tsx) or, in static HTML, follow
 * the character with U+FE0E (text presentation).
 *
 * Allowed: ASCII (digits, # and * have emoji forms only with U+FE0F), and the
 * signs every text face carries (© ® ™). Characters that are emoji by default
 * (Emoji_Presentation=Yes) are chosen as emoji on every platform.
 */

const root = join(__dirname, '../..')
const ALLOWED = new Set(['©', '®', '™'])
const TEXT_DEFAULT_EMOJI =
  /(?=\p{Emoji})(?!\p{Emoji_Presentation})[^\x00-\x7F]/gu

function uiFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', 'app', 'components', 'lib', 'public'],
    { cwd: root, encoding: 'utf8' }
  )
  return out.split('\n').filter((file) => /\.(tsx?|css|html)$/.test(file))
}

test('UI text holds no character that iPhone may draw as an emoji', () => {
  const found: string[] = []
  for (const file of uiFiles()) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const match of text.matchAll(TEXT_DEFAULT_EMOJI)) {
      const character = match[0]
      if (ALLOWED.has(character)) continue
      if (text[match.index + character.length] === '︎') continue
      const line = text.slice(0, match.index).split('\n').length
      found.push(
        `${file}:${line} U+${character.codePointAt(0)!.toString(16).toUpperCase()} ${character}`
      )
    }
  }
  expect(found).toEqual([])
})
