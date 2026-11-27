import { describe, expect, it, vi } from 'vitest'
import { SIGN_OUT_PACKAGES, runSignOutCleanups } from '@/shell/signOut'

describe('sign-out cleanups (shell/signOut)', () => {
  it('has one file per package', () => {
    expect(Object.keys(SIGN_OUT_PACKAGES).sort()).toEqual([
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

  it('runs every cleanup, and one failure does not stop the rest', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ran: string[] = []
    const failed = await runSignOutCleanups([
      { name: 'a', run: () => void ran.push('a') },
      { name: 'b', run: () => Promise.reject(new Error('no')) },
      { name: 'c', run: async () => void ran.push('c') },
    ])
    expect(ran.sort()).toEqual(['a', 'c'])
    expect(failed).toEqual(['b'])
    quiet.mockRestore()
  })
})
