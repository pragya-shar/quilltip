import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetWalletPickerOpenForTests } from '@/lib/stellar/wallet-picker-state'

const walletKitState = vi.hoisted(() => ({
  modalCallbacks: null as {
    onWalletSelected: (option: { id: string }) => Promise<void>
    onClosed: (error?: unknown) => void
  } | null,
  openModal: vi.fn(),
  setWallet: vi.fn(),
  getAddress: vi.fn(),
  getNetwork: vi.fn(),
  getSupportedWallets: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
  },
}))

vi.mock('@/lib/stellar/wallet-kit-loader', () => ({
  loadWalletKit: vi.fn(async () => ({
    StellarWalletsKit: class {
      openModal(callbacks: NonNullable<typeof walletKitState.modalCallbacks>) {
        return walletKitState.openModal(callbacks)
      }

      setWallet(walletId: string) {
        return walletKitState.setWallet(walletId)
      }

      getAddress() {
        return walletKitState.getAddress()
      }

      getNetwork() {
        return walletKitState.getNetwork()
      }

      getSupportedWallets() {
        return walletKitState.getSupportedWallets()
      }
    },
    allowAllModules: vi.fn(() => []),
    WalletNetwork: { PUBLIC: 'PUBLIC', TESTNET: 'TESTNET' },
  })),
}))

describe('walletAdapter', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    resetWalletPickerOpenForTests()
    walletKitState.modalCallbacks = null
    walletKitState.openModal.mockReset()
    walletKitState.setWallet.mockReset()
    walletKitState.getAddress.mockReset()
    walletKitState.getNetwork.mockReset()
    walletKitState.getSupportedWallets.mockReset()

    const storage = new Map<string, string>()
    vi.stubGlobal('window', {
      location: { hostname: 'localhost', protocol: 'https:' },
    })
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key)
      }),
    })

    walletKitState.getSupportedWallets.mockResolvedValue([
      { id: 'freighter', isAvailable: true },
    ])
    walletKitState.openModal.mockImplementation((callbacks) => {
      if (walletKitState.modalCallbacks) {
        throw new Error('Stellar Wallets Kit modal is already open')
      }
      walletKitState.modalCallbacks = callbacks
    })
    walletKitState.getAddress.mockResolvedValue({
      address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    })
    walletKitState.getNetwork.mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
  })

  it('shares an in-flight connect attempt instead of reopening the wallet modal', async () => {
    const { walletAdapter } = await import('@/lib/stellar/wallet-adapter')
    const { getWalletPickerOpen } =
      await import('@/lib/stellar/wallet-picker-state')

    const firstConnect = walletAdapter.connect()
    const secondConnect = walletAdapter.connect()

    await vi.waitFor(() => {
      expect(walletKitState.openModal).toHaveBeenCalledTimes(1)
      expect(walletKitState.modalCallbacks).not.toBeNull()
      expect(getWalletPickerOpen()).toBe(true)
    })

    await walletKitState.modalCallbacks?.onWalletSelected({ id: 'freighter' })

    await expect(firstConnect).resolves.toEqual({
      publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
    await expect(secondConnect).resolves.toEqual({
      publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
    expect(getWalletPickerOpen()).toBe(false)
  })
})
