import { describe, expect, it } from 'vitest'
import { hasInstalledWalletForKitModal } from '@/lib/stellar/wallet-availability'

describe('hasInstalledWalletForKitModal', () => {
  it('returns false when only web-fallback wallets are available', () => {
    expect(
      hasInstalledWalletForKitModal([
        { id: 'albedo', isAvailable: true },
        { id: 'xbull', isAvailable: true },
        { id: 'hot-wallet', isAvailable: true },
      ])
    ).toBe(false)
  })

  it('returns true when an extension-style wallet is available', () => {
    expect(
      hasInstalledWalletForKitModal([
        { id: 'albedo', isAvailable: true },
        { id: 'freighter', isAvailable: true },
      ])
    ).toBe(true)
  })

  it('returns false when no wallets are available', () => {
    expect(
      hasInstalledWalletForKitModal([
        { id: 'albedo', isAvailable: false },
        { id: 'freighter', isAvailable: false },
      ])
    ).toBe(false)
  })
})
