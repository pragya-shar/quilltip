import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SIGNED_IN_MARKER,
  isSigningOut,
  markSignedIn,
  settleSignedOut,
  signOutHere,
} from '@/shell/signOut/session'
import { signInHref } from '@/shell/signIn'
import { REMEMBERED_WALLET_PREFIX } from '@/lib/wallet/remembered-wallet'

/** localStorage in memory. */
function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries))
  return {
    map,
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
  }
}

const TOKEN = '__convexAuthJWT_example'
const RECORD = `${REMEMBERED_WALLET_PREFIX}user1`
const KIT = '@StellarWalletsKit/activeAddress'
const walletKeys = (storage: ReturnType<typeof memoryStorage>) =>
  [...storage.map.keys()].filter((k) => k === RECORD || k.startsWith('@'))

afterEach(() => vi.unstubAllGlobals())

describe('the signed-in marker', () => {
  it('says only that this browser was signed in', () => {
    const storage = memoryStorage({ [TOKEN]: 't' })
    markSignedIn(storage)
    expect(storage.getItem(SIGNED_IN_MARKER)).toBe('1')
  })

  it('finishes a sign-out made where the shell did not see it', async () => {
    // Signed out on a legacy page: the token is gone, the marker is not.
    const storage = memoryStorage({
      [SIGNED_IN_MARKER]: '1',
      [RECORD]: '{}',
      [KIT]: 'G...',
    })
    expect(isSigningOut(storage)).toBe(true)
    const run = vi.fn(async () => {})
    expect(await settleSignedOut(storage, run)).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(storage.getItem(SIGNED_IN_MARKER)).toBeNull()
    expect(walletKeys(storage)).toEqual([])
    // Once is enough.
    expect(await settleSignedOut(storage, run)).toBe(false)
    expect(run).toHaveBeenCalledOnce()
  })

  it('does nothing while a token is held', async () => {
    const storage = memoryStorage({
      [TOKEN]: 't',
      [SIGNED_IN_MARKER]: '1',
      [RECORD]: '{}',
    })
    const run = vi.fn(async () => {})
    expect(await settleSignedOut(storage, run)).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(storage.getItem(RECORD)).toBe('{}')
  })

  it('leaves no wallet record for a signed-out browser, marker or not', async () => {
    const storage = memoryStorage({ [RECORD]: '{}', [KIT]: 'G...' })
    expect(await settleSignedOut(storage, async () => {})).toBe(false)
    expect(walletKeys(storage)).toEqual([])
  })
})

describe('signing out here', () => {
  it('leaves no wallet record when a wallet writes during sign-out', async () => {
    const storage = memoryStorage({
      [TOKEN]: 't',
      [SIGNED_IN_MARKER]: '1',
      [RECORD]: '{}',
    })
    await signOutHere(async () => {
      storage.setItem(KIT, 'G...') // the kit's teardown, before the token goes
      storage.removeItem(TOKEN)
      storage.setItem(RECORD, '{}') // and after it
    }, storage)
    expect(walletKeys(storage)).toEqual([])
    expect(storage.getItem(SIGNED_IN_MARKER)).toBeNull()
  })

  it('runs the actions before sign-out while the session is held, then signs out', async () => {
    const storage = memoryStorage({ [TOKEN]: 't', [SIGNED_IN_MARKER]: '1' })
    const order: string[] = []
    await signOutHere(
      async () => {
        order.push(
          `sign out (token ${storage.getItem(TOKEN) ? 'held' : 'gone'})`
        )
        storage.removeItem(TOKEN)
      },
      storage,
      async () => void order.push('cleanups'),
      async () =>
        void order.push(
          `before (token ${storage.getItem(TOKEN) ? 'held' : 'gone'})`
        )
    )
    expect(order).toEqual([
      'before (token held)',
      'sign out (token held)',
      'cleanups',
    ])
  })

  it('runs no action before sign-out when the session already ended', async () => {
    const storage = memoryStorage({ [SIGNED_IN_MARKER]: '1' })
    const before = vi.fn(async () => {})
    await signOutHere(
      async () => {},
      storage,
      async () => {},
      before
    )
    expect(before).not.toHaveBeenCalled()
  })

  it('signs out even when an action before it fails', async () => {
    const storage = memoryStorage({ [TOKEN]: 't', [SIGNED_IN_MARKER]: '1' })
    const signOut = vi.fn(async () => void storage.removeItem(TOKEN))
    await signOutHere(
      signOut,
      storage,
      async () => {},
      async () => {
        throw new Error('offline')
      }
    )
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('removes a record a teardown writes after sign-out on the next load', async () => {
    const storage = memoryStorage({ [TOKEN]: 't', [SIGNED_IN_MARKER]: '1' })
    await signOutHere(async () => void storage.removeItem(TOKEN), storage)
    storage.setItem(RECORD, '{}') // a late teardown
    await settleSignedOut(storage, async () => {}) // the next shell load
    expect(walletKeys(storage)).toEqual([])
  })

  it('finishes on the next page when the page changes mid sign-out', async () => {
    const page = new EventTarget()
    vi.stubGlobal('window', page)
    // A module of its own: this sign-out never ends, as the page left.
    vi.resetModules()
    const { signOutHere, settleSignedOut } =
      await import('@/shell/signOut/session')
    const storage = memoryStorage({
      [TOKEN]: 't',
      [SIGNED_IN_MARKER]: '1',
      [RECORD]: '{}',
    })
    const run = vi.fn(async () => {})
    // The token goes, then the page leaves before the server answers.
    void signOutHere(
      () =>
        new Promise<void>(() => {
          storage.removeItem(TOKEN)
          storage.setItem(KIT, 'G...')
        }),
      storage,
      run
    )
    page.dispatchEvent(new Event('pagehide'))
    expect(walletKeys(storage)).toEqual([])
    expect(run).not.toHaveBeenCalled()
    // The next shell page.
    expect(await settleSignedOut(storage, run)).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(storage.getItem(SIGNED_IN_MARKER)).toBeNull()
  })

  it('writes no return path while signing out', async () => {
    const storage = memoryStorage({ [TOKEN]: 't', [SIGNED_IN_MARKER]: '1' })
    expect(signInHref('/shelf', storage)).toBe('/login?returnTo=%2Fshelf')
    expect(signInHref()).toBe('/login')
    expect(signInHref('https://evil.example/x')).toBe('/login?returnTo=%2F')
    let during = ''
    await signOutHere(async () => {
      during = signInHref('/shelf')
      storage.removeItem(TOKEN)
    }, storage)
    expect(during).toBe('/login')
    expect(signInHref('/shelf', storage)).toBe('/login?returnTo=%2Fshelf')
  })
})
