import { describe, expect, it } from 'vitest'
import { SHEET_DECLARATIONS, SHEET_PACKAGES } from '@/shell/sheets'
import { registerSheet } from '@/shell/sheetRegistry'
import { sheetStack } from '@/shell/sheetStack'
import { vi } from 'vitest'

describe('declared sheets (shell/sheets)', () => {
  it('has one file per package', () => {
    expect(Object.keys(SHEET_PACKAGES).sort()).toEqual([
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

  it("uses each id once across packages, never the shell's own", () => {
    const ids = Object.values(SHEET_PACKAGES).flatMap((p) => Object.keys(p))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain('pocket')
  })

  it('gives every sheet a title and a loader', () => {
    for (const [id, sheet] of Object.entries(SHEET_DECLARATIONS)) {
      expect(['string', 'function'], id).toContain(typeof sheet.title)
      expect(typeof sheet.load, id).toBe('function')
    }
  })
})

describe('the sheet stack', () => {
  it('refuses an id nobody can draw, so no hidden entry stays open', () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(sheetStack.open('nothing-here')).toBe(false)
    expect(sheetStack.get().some((e) => e.id === 'nothing-here')).toBe(false)
    quiet.mockRestore()
  })

  it('opens a registered sheet once', () => {
    const Sheet = () => null
    registerSheet('test-registered', Sheet)
    expect(sheetStack.open('test-registered')).toBe(true)
    expect(sheetStack.open('test-registered')).toBe(true)
    expect(
      sheetStack.get().filter((e) => e.id === 'test-registered')
    ).toHaveLength(1)
  })

  it("refuses a second sheet under the same id, and the shell's own", () => {
    const Other = () => null
    expect(() => registerSheet('test-registered', Other)).toThrow(
      'already registered'
    )
    expect(() => registerSheet('pocket', Other)).toThrow()
  })
})
