/**
 * A tip control on a page without the payments shell answers at once that
 * payments are absent, so a host (the passage slip) keeps its wallet tip
 * path instead of waiting for an answer that never comes. With the shell
 * mounted, the control waits for the auth state as before.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { shellController, viewsOf } from '../../lib/payments/runtime'
import { paymentsStore } from '../../lib/payments/store'
import type { BalanceView, TipTarget } from '../../lib/payments/types'

let detach: (() => void) | null = null
afterEach(() => {
  detach?.()
  detach = null
  paymentsStore.setAuth('loading')
  paymentsStore.set({ engine: 'idle' })
})

describe('the views before the engine writes them', () => {
  const status = () => {
    const v = viewsOf(paymentsStore.get())
    return [
      v.balance.status,
      v.readerActivity.status,
      v.writerActivity.status,
      v.earnings.status,
    ]
  }

  it('reads loading, then signed out, then unavailable after a failure', () => {
    expect(status()).toEqual(['loading', 'loading', 'loading', 'loading'])
    paymentsStore.setAuth('signed-out')
    expect(status()).toEqual(['signed-out', 'loading', 'loading', 'signed-out'])
    paymentsStore.setAuth('signed-in')
    paymentsStore.fail()
    expect(status()).toEqual([
      'unavailable',
      'unavailable',
      'unavailable',
      'unavailable',
    ])
  })

  it('returns the same blank view on each read, for useSyncExternalStore', () => {
    const s = paymentsStore.get()
    expect(viewsOf(s).balance).toBe(viewsOf(s).balance)
    expect(viewsOf(s).earnings).toBe(viewsOf(s).earnings)
  })

  it('shows nothing of one reader to the next', () => {
    paymentsStore.setAuth('signed-in')
    const ready = { status: 'ready' } as BalanceView
    paymentsStore.set({ balance: ready })
    expect(viewsOf(paymentsStore.get()).balance).toBe(ready)
    paymentsStore.setAuth('signed-out')
    expect(viewsOf(paymentsStore.get()).balance.status).toBe('signed-out')
    expect(paymentsStore.get().tips).toEqual({})
  })
})

describe('payments shell presence', () => {
  it('reports absent at once when no shell is mounted', () => {
    const tip = shellController('passage')
    expect(tip.ready).toBe(true)
    expect(tip.warming).toBe(false)
    expect(tip.unavailable).toBe('absent')
  })

  it('waits for the auth state while a shell is mounted', () => {
    detach = paymentsStore.attachShell()
    expect(shellController('passage')).toMatchObject({
      ready: false,
      warming: false,
      unavailable: null,
    })
    paymentsStore.setAuth('signed-in')
    expect(shellController('passage')).toMatchObject({
      ready: false,
      warming: true,
      unavailable: null,
    })
    paymentsStore.setAuth('signed-out')
    expect(shellController('passage')).toMatchObject({
      ready: true,
      unavailable: 'signed-out',
    })
  })

  it('reports absent again once the shell unmounts', () => {
    const off = paymentsStore.attachShell()
    expect(shellController('passage').unavailable).toBe(null)
    off()
    expect(shellController('passage').unavailable).toBe('absent')
  })

  it('is always told whether the visitor is signed out (null here)', () => {
    expect(shellController('passage').signedOut).toBeNull()
    detach = paymentsStore.attachShell()
    paymentsStore.setAuth('signed-out')
    expect(shellController('passage').signedOut).toBeNull()
  })
})

describe('a press before the engine loads', () => {
  const meta = {
    articleTitle: 'An article',
    writerName: 'A writer',
    href: null,
  }
  const lineA: TipTarget = {
    kind: 'passage',
    articleId: 'jh7777s11fpgcd26ntb8fzy45s8k1jkb' as Id<'articles'>,
    passage: { text: 'Line A', startOffset: 0, endOffset: 6 },
  }
  const lineB: TipTarget = {
    kind: 'passage',
    articleId: 'jh7777s11fpgcd26ntb8fzy45s8k1jkb' as Id<'articles'>,
    passage: { text: 'Line B', startOffset: 40, endOffset: 46 },
  }

  afterEach(() => paymentsStore.unregister('passage'))

  it('keeps the target, amount and request id of the press', async () => {
    detach = paymentsStore.attachShell()
    paymentsStore.setAuth('signed-in')
    paymentsStore.register('passage', { target: lineA, meta })
    await shellController('passage').tip()
    expect(shellController('passage').queued).toBe(true)
    const pressed = paymentsStore.get().queuedTaps.passage!

    // The reader selects line B before the engine is ready, and presses again.
    paymentsStore.register('passage', { target: lineB, meta })
    await shellController('passage').tip()

    const tap = paymentsStore.takeTap('passage')
    expect(tap?.target).toEqual(lineA)
    expect(tap?.cents).toBe(100)
    expect(tap?.requestId).toBe(pressed.requestId)
    expect(tap?.requestId).toMatch(/^[0-9a-f-]{36}$/)
    // Taken once: the engine cannot send it twice.
    expect(paymentsStore.takeTap('passage')).toBeUndefined()
  })

  it('queues nothing without a shell, signed out, or unregistered', async () => {
    paymentsStore.register('passage', { target: lineA, meta })
    await shellController('passage').tip()
    expect(paymentsStore.takeTap('passage')).toBeUndefined()

    detach = paymentsStore.attachShell()
    paymentsStore.setAuth('signed-out')
    await shellController('passage').tip()
    expect(paymentsStore.takeTap('passage')).toBeUndefined()

    paymentsStore.setAuth('signed-in')
    await shellController('other').tip()
    expect(paymentsStore.takeTap('other')).toBeUndefined()
  })
})
