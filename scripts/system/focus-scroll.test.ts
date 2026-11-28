import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.join(__dirname, '../..')

/**
 * Focus moved by script must not scroll the page (`preventScroll`), except
 * a roving focus that a key moves inside a visible list, where bringing the
 * target into view is the point. Those are listed by file and line text.
 */
const ROVING = [
  ['system/components/Tabs.tsx', '[next]?.focus()'],
  ['system/components/useModal.ts', 'items[next]?.focus()'],
  [
    'system/components/Menu.tsx',
    'all[(index + all.length) % all.length]?.focus()',
  ],
  ['system/components/AmountTray.tsx', 'radios()[next]?.focus()'],
] as const

function files(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap((name) => {
    const rel = path.join(dir, name)
    if (statSync(path.join(root, rel)).isDirectory()) return files(rel)
    return /\.(ts|tsx)$/.test(name) ? [rel] : []
  })
}

describe('focus moved by script', () => {
  it('never scrolls the page in the system and the shell, except a roving focus', () => {
    const bare: string[] = []
    for (const file of [...files('system'), ...files('shell')])
      readFileSync(path.join(root, file), 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (!/\.focus\(\s*\)/.test(line)) return
          if (ROVING.some(([f, text]) => f === file && line.includes(text)))
            return
          bare.push(`${file}:${index + 1}: ${line.trim()}`)
        })
    expect(
      bare,
      'add { preventScroll: true }, or list a roving focus here'
    ).toEqual([])
  })
})
