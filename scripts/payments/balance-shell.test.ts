// @vitest-environment happy-dom
/**
 * A tip control on a page without the payments shell answers at once that
 * payments are absent, so a host (the passage slip) keeps its wallet tip
 * path instead of waiting for an answer that never comes. With the shell
 * mounted, the control waits for the auth state as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Id } from '../../convex/_generated/dataModel'
import { shellController, viewsOf } from '../../lib/payments/runtime'
import { TAP_WAIT_MS, paymentsStore } from '../../lib/payments/store'
import type { BalanceView, TipTarget } from '../../lib/payments/types'
import { A, tokenNames } from './sessionToken'

let detach: (() => void) | null = null
afterEach(() => {
  detach?.()
  detach = null
  paymentsStore.setAuth('loading')
  window.localStorage.clear()
  paymentsStore.setSession(null)
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
    tokenNames(A)
    paymentsStore.setAuth('signed-in')
    paymentsStore.claim(A)
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
    tokenNames(A)
    paymentsStore.setAuth('signed-in')
    paymentsStore.register('passage', { target: lineA, meta })
    await shellController('passage').tip()
    expect(shellController('passage').queued).toBe(true)
    const pressed = paymentsStore.get().queuedTaps.passage!

    // The reader selects line B before the engine is ready, and presses again.
    paymentsStore.register('passage', { target: lineB, meta })
    await shellController('passage').tip()

    // The engine claims the store for this reader, then takes the press.
    paymentsStore.claim(A)
    const tap = paymentsStore.takeTap('passage', A)
    expect(tap?.target).toEqual(lineA)
    expect(tap?.cents).toBe(100)
    expect(tap?.requestId).toBe(pressed.requestId)
    expect(tap?.requestId).toMatch(/^[0-9a-f-]{36}$/)
    // Taken once: the engine cannot send it twice.
    expect(paymentsStore.takeTap('passage', A)).toBeUndefined()
  })

  describe('a press that waits too long', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    const press = async () => {
      detach = paymentsStore.attachShell()
      tokenNames(A)
      paymentsStore.setAuth('signed-in')
      paymentsStore.register('passage', { target: lineA, meta })
      await shellController('passage').tip()
      paymentsStore.claim(A)
    }

    it('is sent when the engine is ready within 3 s', async () => {
      vi.useFakeTimers()
      await press()
      vi.advanceTimersByTime(TAP_WAIT_MS - 1)
      expect(paymentsStore.takeTap('passage', A)?.target).toEqual(lineA)
      expect(shellController('passage').missed).toBe(false)
    })

    it('is dropped after 3 s, and the control says nothing was sent', async () => {
      vi.useFakeTimers()
      await press()
      vi.advanceTimersByTime(TAP_WAIT_MS)
      expect(paymentsStore.takeTap('passage', A)).toBeUndefined()
      expect(shellController('passage').queued).toBe(false)
      expect(shellController('passage').missed).toBe(true)

      // The next press is a new tap; the control no longer says so.
      await shellController('passage').tip()
      expect(shellController('passage').missed).toBe(false)
      expect(shellController('passage').queued).toBe(true)
    })

    it('is dropped when taken late, even if its timer has not run', async () => {
      vi.useFakeTimers()
      await press()
      // A hidden tab can run a timer late: the clock alone decides.
      vi.setSystemTime(Date.now() + TAP_WAIT_MS + 1)
      expect(paymentsStore.takeTap('passage', A)).toBeUndefined()
      expect(paymentsStore.get().missedTaps.passage).toBe(true)
    })

    it('is shown missed to nobody else', async () => {
      vi.useFakeTimers()
      await press()
      vi.advanceTimersByTime(TAP_WAIT_MS)
      paymentsStore.setAuth('signed-out')
      expect(paymentsStore.get().missedTaps).toEqual({})
    })
  })

  it('queues nothing without a shell, signed out, or unregistered', async () => {
    paymentsStore.register('passage', { target: lineA, meta })
    await shellController('passage').tip()
    expect(paymentsStore.takeTap('passage', A)).toBeUndefined()

    detach = paymentsStore.attachShell()
    paymentsStore.setAuth('signed-out')
    await shellController('passage').tip()
    expect(paymentsStore.takeTap('passage', A)).toBeUndefined()

    paymentsStore.setAuth('signed-in')
    await shellController('other').tip()
    expect(paymentsStore.takeTap('other', A)).toBeUndefined()
  })
})
