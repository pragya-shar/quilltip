import { describe, expect, it, vi } from 'vitest'
import {
  SIGN_OUT_PACKAGES,
  SIGN_OUT_WARNINGS,
  runSignOutCleanups,
  signOutWarnings,
} from '@/shell/signOut'

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

describe('sign-out warnings', () => {
  it('says each sentence, and nothing for a check that fails or runs late', async () => {
    const said = await signOutWarnings(
      [
        { name: 'a', check: async () => '2 drafts are only on this device.' },
        { name: 'b', check: async () => null },
        { name: 'c', check: async () => '  ' },
        {
          name: 'd',
          check: async () => {
            throw new Error('no')
          },
        },
        {
          name: 'e',
          check: () => new Promise((r) => setTimeout(() => r('late'), 200)),
        },
      ],
      50
    )
    expect(said).toEqual(['2 drafts are only on this device.'])
  })

  it('has a warnings list in every package file', () => {
    expect(SIGN_OUT_WARNINGS).toEqual([])
  })
})
