import { describe, expect, it } from 'vitest'
import { SHEET_DECLARATIONS, SHEET_PACKAGES } from '@/shell/sheets'

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
