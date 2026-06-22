import { describe, expect, it, vi } from 'vitest'
import { connectWalletFromOverlay } from './connectWalletFromOverlay'

describe('connectWalletFromOverlay', () => {
  it('closes overlay before connect and reopens after success', async () => {
    const order: string[] = []
    const activateWallet = vi.fn(() => order.push('activate'))
    const connect = vi.fn(async () => {
      order.push('connect')
      return true
    })
    const closeOverlay = vi.fn(() => {
      order.push('close')
    })
    const reopenOverlay = vi.fn(() => {
      order.push('reopen')
    })
    const yieldToBrowser = vi.fn(async () => {
      order.push('yield')
    })

    const result = await connectWalletFromOverlay({
      activateWallet,
      connect,
      closeOverlay,
      reopenOverlay,
      yieldToBrowser,
    })

    expect(result).toBe(true)
    expect(order).toEqual(['activate', 'close', 'yield', 'connect', 'reopen'])
  })

  it('reopens overlay when connect throws', async () => {
    const reopenOverlay = vi.fn()
    const connect = vi.fn(async () => {
      throw new Error('Wallet selection cancelled')
    })

    await expect(
      connectWalletFromOverlay({
        activateWallet: vi.fn(),
        connect,
        closeOverlay: vi.fn(),
        reopenOverlay,
        yieldToBrowser: vi.fn(async () => {}),
      })
    ).rejects.toThrow('Wallet selection cancelled')

    expect(reopenOverlay).toHaveBeenCalledTimes(1)
  })
})
