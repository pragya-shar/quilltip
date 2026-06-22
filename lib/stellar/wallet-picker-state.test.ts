/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from 'vitest'
import {
  getWalletPickerOpen,
  resetWalletPickerOpenForTests,
  setWalletPickerOpen,
  subscribeWalletPickerOpen,
} from '@/lib/stellar/wallet-picker-state'

describe('wallet-picker-state', () => {
  beforeEach(() => {
    resetWalletPickerOpenForTests()
  })

  it('tracks open state and notifies subscribers', () => {
    const calls: boolean[] = []
    const unsubscribe = subscribeWalletPickerOpen(() => {
      calls.push(getWalletPickerOpen())
    })

    setWalletPickerOpen(true)
    setWalletPickerOpen(true)
    setWalletPickerOpen(false)

    expect(calls).toEqual([true, false])
    unsubscribe()
  })

  it('clears subscribers during test reset', () => {
    const calls: boolean[] = []
    subscribeWalletPickerOpen(() => {
      calls.push(getWalletPickerOpen())
    })

    resetWalletPickerOpenForTests()
    setWalletPickerOpen(true)

    expect(calls).toEqual([])
  })

  it('removes inert from the stellar wallet picker while open', () => {
    const walletModal = document.createElement('stellar-wallets-modal')
    walletModal.setAttribute('inert', '')
    document.body.appendChild(walletModal)

    setWalletPickerOpen(true)
    expect(walletModal.hasAttribute('inert')).toBe(false)

    setWalletPickerOpen(false)
    document.body.removeChild(walletModal)
  })
})
