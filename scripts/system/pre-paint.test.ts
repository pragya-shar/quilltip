import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { PRE_PAINT_SCRIPT } from '@/shell/prePaint'

/** Runs the script against a stand-in page, as the browser would. */
function run(storage: Record<string, string> = {}) {
  const listeners: Record<string, ((event: unknown) => void)[]> = {}
  const root = {
    dataset: {} as Record<string, string>,
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v
    },
  }
  const keys = Object.keys(storage)
  runInNewContext(PRE_PAINT_SCRIPT, {
    document: { documentElement: root },
    localStorage: {
      getItem: (k: string) => storage[k] ?? null,
      key: (i: number) => keys[i] ?? null,
      length: keys.length,
    },
    addEventListener: (type: string, fn: (event: unknown) => void) =>
      (listeners[type] ??= []).push(fn),
  })
  return { root, listeners }
}

describe('the pre-paint script', () => {
  it('sets the stored theme and the held session', () => {
    const { root } = run({ theme: 'dark', __convexAuthJWT_x: 't' })
    expect(root.dataset.theme).toBe('dark')
    expect(root.attrs['data-session']).toBe('held')
  })

  it('settles an aborted view transition, so nothing rejects unhandled', async () => {
    const { listeners } = run()
    const aborted = () => Promise.reject(new Error('Transition was aborted'))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      for (const type of ['pagereveal', 'pageswap']) {
        expect(listeners[type]).toHaveLength(1)
        listeners[type]![0]!({
          viewTransition: {
            ready: aborted(),
            finished: aborted(),
            updateCallbackDone: aborted(),
          },
        })
        listeners[type]![0]!({ viewTransition: null })
      }
      await new Promise((resolve) => setTimeout(resolve, 20))
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
    expect(unhandled).toEqual([])
  })

  it('never throws, even with storage blocked', () => {
    expect(() =>
      runInNewContext(PRE_PAINT_SCRIPT, {
        document: { documentElement: { dataset: {} } },
        get localStorage() {
          throw new Error('blocked')
        },
        addEventListener: () => {},
      })
    ).not.toThrow()
  })
})
