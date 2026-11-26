import { describe, expect, it } from 'vitest'

import {
  checkBunVersion,
  compareVersions,
  requiredBunVersion,
} from '../check-bun-version'

describe('Bun version guard', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.4.4', '1.4.4')).toBe(0)
    expect(compareVersions('1.10.0', '1.4.4')).toBe(1)
    expect(compareVersions('1.3.14', '1.4.4')).toBe(-1)
  })

  it('reads the packageManager pin', () => {
    expect(requiredBunVersion('bun@1.4.4')).toBe('1.4.4')
    expect(() => requiredBunVersion('npm@10.0.0')).toThrow()
  })

  it('refuses an older Bun and accepts the pin or newer', () => {
    expect(checkBunVersion('1.3.14', 'bun@1.4.4')).toMatch(
      /older than the pinned Bun 1.4.4/
    )
    expect(checkBunVersion('1.4.4', 'bun@1.4.4')).toBeNull()
    expect(checkBunVersion('1.5.0', 'bun@1.4.4')).toBeNull()
  })
})
