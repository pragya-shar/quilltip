/**
 * A tip control on a page without the payments shell answers at once that
 * payments are absent, so a host (the passage slip) keeps its wallet tip
 * path instead of waiting for an answer that never comes. With the shell
 * mounted, the control waits for the auth state as before.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { paymentsStore, shellController } from '../../lib/payments/store'

let detach: (() => void) | null = null
afterEach(() => {
  detach?.()
  detach = null
  paymentsStore.setAuth('loading')
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
})
