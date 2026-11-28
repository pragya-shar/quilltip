import { expect, test } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * No UI text holds a character that iPhone may draw as a colour emoji when
 * the page font lacks it (#666): a character with an emoji form that is text
 * by default (Emoji=Yes, Emoji_Presentation=No), such as the arrows ↗ and ↔.
 * Each such character must be followed by U+FE0E (text presentation), in the
 * source as the character itself, or as `\uFE0E` after a `\u` escape.
 *
 * Allowed without it: ASCII (digits, # and * have emoji forms only with
 * U+FE0F), and the signs every text face carries (© ® ™). Characters that are
 * emoji by default (Emoji_Presentation=Yes) are chosen as emoji everywhere.
 *
 * Scope: .ts, .tsx, .js, .mjs, .css and .html files under app, components,
 * lib, public and convex. Not read: .json and .md files, and scripts/.
 */

const root = join(__dirname, '../..')
const ALLOWED = new Set(['©', '®', '™'])
const TEXT_DEFAULT_EMOJI =
  /(?=\p{Emoji})(?!\p{Emoji_Presentation})[^\x00-\x7F]/gu
/** `\u2197` or `\u{2197}` style escapes of the same characters. */
const ESCAPE = /\\u(?:\{([0-9a-fA-F]{4,5})\}|([0-9a-fA-F]{4}))/g

/** Each text-default emoji character in `text` without U+FE0E after it. */
function bareEmojiGlyphs(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(TEXT_DEFAULT_EMOJI)) {
    const character = match[0]
    if (ALLOWED.has(character)) continue
    if (text[match.index + character.length] !== '\uFE0E') found.push(character)
  }
  for (const match of text.matchAll(ESCAPE)) {
    const character = String.fromCodePoint(parseInt(match[1] ?? match[2]!, 16))
    if (!/(?=\p{Emoji})(?!\p{Emoji_Presentation})[^\x00-\x7F]/u.test(character))
      continue
    if (ALLOWED.has(character)) continue
    const after = text.slice(match.index + match[0].length)
    if (!/^(\\uFE0E|\\u\{FE0E\}|\uFE0E)/i.test(after)) found.push(character)
  }
  return found
}

function uiFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', 'app', 'components', 'lib', 'public', 'convex'],
    { cwd: root, encoding: 'utf8' }
  )
  return out.split('\n').filter((file) => /\.(tsx?|m?js|css|html)$/.test(file))
}

test('the check fails on a bare arrow and passes the text-presentation form', () => {
  expect(bareEmojiGlyphs('Sign up <span aria-hidden="true">↗</span>')).toEqual([
    '↗',
  ])
  expect(bareEmojiGlyphs('Sign up ↗\uFE0F')).toEqual(['↗'])
  expect(bareEmojiGlyphs("{'Preview \\u2197'}")).toEqual(['↗'])
  expect(bareEmojiGlyphs('resize ↔')).toEqual(['↔'])
  expect(
    bareEmojiGlyphs('Sign up <span aria-hidden="true">↗\uFE0E</span>')
  ).toEqual([])
  expect(bareEmojiGlyphs("{'Preview \\u2197\\uFE0E'}")).toEqual([])
  expect(bareEmojiGlyphs('© 2026 Quilltip → next')).toEqual([])
})

test('UI text holds no character that iPhone may draw as an emoji', () => {
  const found: string[] = []
  for (const file of uiFiles()) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const character of bareEmojiGlyphs(text))
      found.push(
        `${file} U+${character.codePointAt(0)!.toString(16).toUpperCase()} ${character}`
      )
  }
  expect(found).toEqual([])
})
