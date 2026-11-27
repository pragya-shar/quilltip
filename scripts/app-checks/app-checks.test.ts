import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_CHECKS, APP_CHECK_PACKAGES } from './index'

const root = path.resolve(__dirname, '../..')

describe('production-build checks (scripts/app-checks)', () => {
  it('has one file per package', () => {
    expect(Object.keys(APP_CHECK_PACKAGES).sort()).toEqual([
      'foundation',
      'ops',
      'pocket',
      'read',
      'resources',
      'search',
      'shelf',
      'signin',
      'today',
      'write',
      'writer',
      'you',
    ])
  })

  it('names each check once, with a command', () => {
    const names = APP_CHECKS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const check of APP_CHECKS)
      expect(check.command.length).toBeGreaterThan(0)
  })

  it('points at configs and scripts that exist', () => {
    for (const check of APP_CHECKS)
      for (const arg of check.command)
        if (/\.(ts|mts|mjs|js)$/.test(arg))
          expect(
            existsSync(path.join(root, arg)),
            `${check.name}: ${arg}`
          ).toBe(true)
  })

  it('keeps the shell reading without scripts and crossing in', () => {
    expect(APP_CHECKS.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'reading without scripts',
        'crossing into the shell',
      ])
    )
  })
})
