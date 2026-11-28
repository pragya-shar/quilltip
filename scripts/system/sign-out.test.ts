import { describe, expect, it, vi } from 'vitest'
import {
  SIGN_OUT_BEFORE,
  SIGN_OUT_PACKAGES,
  SIGN_OUT_WARNINGS,
  runBeforeSignOut,
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

  it('gives every check who is signing out', async () => {
    const seen: (string | null)[] = []
    const said = await signOutWarnings(
      [
        {
          name: 'drafts',
          check: async ({ userId }) => {
            seen.push(userId)
            return userId === 'user-1'
              ? 'A draft is only on this device.'
              : null
          },
        },
      ],
      50,
      { userId: 'user-1' }
    )
    expect(seen).toEqual(['user-1'])
    expect(said).toEqual(['A draft is only on this device.'])
    // Not known: the check is asked with null.
    await signOutWarnings(
      [
        {
          name: 'drafts',
          check: async ({ userId }) => (seen.push(userId), null),
        },
      ],
      50
    )
    expect(seen).toEqual(['user-1', null])
  })

  it('has a warnings list in every package file', () => {
    expect(SIGN_OUT_WARNINGS).toEqual([])
  })
})

describe('actions before sign-out', () => {
  it('runs every action at once with who is signing out, and drops one that fails or runs late', async () => {
    const started: string[] = []
    const t0 = Date.now()
    const unfinished = await runBeforeSignOut(
      [
        {
          name: 'revoke',
          run: async ({ userId }) => void started.push(`revoke ${userId}`),
        },
        {
          name: 'fails',
          run: async () => {
            started.push('fails')
            throw new Error('offline')
          },
        },
        {
          name: 'late',
          run: () => {
            started.push('late')
            return new Promise((done) => setTimeout(done, 2000))
          },
        },
      ],
      { userId: 'user-1' },
      100
    )
    expect(started).toEqual(['revoke user-1', 'fails', 'late'])
    expect(unfinished.sort()).toEqual(['fails', 'late'])
    // Never past the limit, whatever an action does.
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('has none registered yet', () => {
    expect(SIGN_OUT_BEFORE).toEqual([])
  })
})
