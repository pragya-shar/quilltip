import { describe, expect, it } from 'vitest'
import {
  signOutStop,
  stopKeys,
  unconfirmedStops,
} from '@/lib/payments/signOutStop'
import { beforeSignOut } from '@/shell/signOut/pocket'
import { BEFORE_LIMIT_MS, runBeforeSignOut } from '@/shell/signOut'
import { signOutHere } from '@/shell/signOut/session'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

describe('before sign-out, Quilltip stops this browser’s quick-tips keys', () => {
  it('runs the stop the engine registered, and nothing with no engine', async () => {
    const stopped: number[] = []
    const off = signOutStop.set(async () => void stopped.push(7))
    await beforeSignOut[0]!.run({ userId: 'reader' })
    expect(stopped).toEqual([7])
    off()
    await beforeSignOut[0]!.run({ userId: 'reader' })
    expect(stopped).toEqual([7])
    await expect(signOutStop.run()).resolves.toBeUndefined()
  })

  it('calls the stop within the shell’s bound, and signing out completes when it is slow or fails', async () => {
    for (const stop of [
      () => new Promise<void>((r) => setTimeout(r, 5000)),
      () => Promise.reject(new Error('offline')),
    ]) {
      let called = 0
      const off = signOutStop.set(async () => {
        called += 1
        await stop()
      })
      const started = Date.now()
      const unfinished = await runBeforeSignOut(beforeSignOut)
      expect(called).toBe(1)
      expect(Date.now() - started).toBeLessThan(BEFORE_LIMIT_MS + 400)
      expect(unfinished).toEqual(['stop quick tips keys'])
      off()
    }
  })

  it('signs out after a slow stop, with the token still held while it runs', async () => {
    let signedOut = false
    let stopRan = false
    const off = signOutStop.set(
      () =>
        new Promise<void>((r) => {
          stopRan = true
          setTimeout(r, 5000)
        })
    )
    const storage = memoryStorage()
    storage.setItem('__convexAuthJWT_test', 'token')
    const started = Date.now()
    await signOutHere(
      async () => {
        signedOut = true
      },
      storage,
      async () => {},
      () => runBeforeSignOut(beforeSignOut)
    ).catch(() => {})
    expect(stopRan).toBe(true)
    expect(signedOut).toBe(true)
    expect(Date.now() - started).toBeLessThan(BEFORE_LIMIT_MS + 1500)
    off()
  })
})

describe('a stop that was not confirmed', () => {
  it('is noted for the reader, cleared when the server confirms, kept when it fails', async () => {
    const store = memoryStorage()
    await stopKeys(
      'reader',
      [1, 2],
      async (keyId) => {
        if (keyId === 2) throw new Error('offline')
      },
      store
    )
    expect(unconfirmedStops('reader', store)).toEqual([2])
    expect(unconfirmedStops('someone-else', store)).toEqual([])
    // The next sign-in tries again; confirmed, the note goes.
    await stopKeys('reader', [2], async () => {}, store)
    expect(unconfirmedStops('reader', store)).toEqual([])
  })

  it('stays noted when the sign-out ends before the server answers', async () => {
    const store = memoryStorage()
    void stopKeys('reader', [5], () => new Promise(() => {}), store)
    expect(unconfirmedStops('reader', store)).toEqual([5])
  })
})
