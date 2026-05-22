import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@ngneat/elf', () => ({
  enableElfProdMode: vi.fn(),
}))

vi.mock('@creit.tech/stellar-wallets-kit', () => ({
  StellarWalletsKit: class StellarWalletsKit {},
  allowAllModules: vi.fn(),
  WalletNetwork: { TESTNET: 'TESTNET' },
}))

describe('loadWalletKit', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.unstubAllEnvs()
    const { enableElfProdMode } = await import('@ngneat/elf')
    vi.mocked(enableElfProdMode).mockClear()
  })

  it('calls enableElfProdMode before importing wallet kit in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { enableElfProdMode } = await import('@ngneat/elf')
    const { loadWalletKit } = await import('@/lib/stellar/wallet-kit-loader')

    await loadWalletKit()

    expect(enableElfProdMode).toHaveBeenCalledOnce()
  })

  it('does not call enableElfProdMode outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const { enableElfProdMode } = await import('@ngneat/elf')
    const { loadWalletKit } = await import('@/lib/stellar/wallet-kit-loader')

    await loadWalletKit()

    expect(enableElfProdMode).not.toHaveBeenCalled()
  })
})
