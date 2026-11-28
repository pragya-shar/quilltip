import { describe, expect, it } from 'vitest'
import { signOutStop } from '@/lib/payments/signOutStop'
import { beforeSignOut } from '@/shell/signOut/pocket'

describe('before sign-out, Quilltip stops this browser’s quick-tips keys', () => {
  it('runs the stop the engine registered, once per sign-out', async () => {
    const stopped: number[] = []
    const off = signOutStop.set(async () => {
      stopped.push(7)
    })
    await beforeSignOut[0]!.run({ userId: 'reader' })
    expect(stopped).toEqual([7])
    off()
    await beforeSignOut[0]!.run({ userId: 'reader' })
    expect(stopped).toEqual([7])
  })

  it('does nothing, and never throws, with no engine on the page', async () => {
    await expect(signOutStop.run()).resolves.toBeUndefined()
  })

  it('keeps only the latest engine’s stop, and a stale removal leaves it', async () => {
    const calls: string[] = []
    const offA = signOutStop.set(async () => void calls.push('a'))
    const offB = signOutStop.set(async () => void calls.push('b'))
    offA()
    await signOutStop.run()
    expect(calls).toEqual(['b'])
    offB()
  })
})
