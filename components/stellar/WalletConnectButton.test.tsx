/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { WalletConnectButton } from '@/components/stellar/WalletConnectButton'

const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockActivateWallet = vi.fn()

const TEST_PUBLIC_KEY = 'GBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGBGB'

vi.mock('@/components/providers/WalletProvider', () => ({
  useWallet: vi.fn(),
}))

vi.mock('@/components/providers/WalletActivationContext', () => ({
  useWalletActivation: () => ({
    activateWallet: mockActivateWallet,
    isWalletActive: true,
  }),
}))

vi.mock('@/components/stellar/InstallWalletDialog', () => ({
  InstallWalletDialog: () => null,
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

import { useWallet } from '@/components/providers/WalletProvider'

function mockWalletState(
  overrides: Partial<ReturnType<typeof useWallet>> = {}
) {
  vi.mocked(useWallet).mockReturnValue({
    isInstalled: true,
    isConnected: false,
    isLoading: false,
    publicKey: null,
    network: null,
    networkPassphrase: null,
    error: null,
    selectedWallet: null,
    connect: mockConnect,
    disconnect: mockDisconnect,
    signTransaction: vi.fn(),
    refreshConnection: vi.fn(),
    ...overrides,
  })
}

describe('WalletConnectButton', () => {
  beforeEach(() => {
    mockConnect.mockReset()
    mockDisconnect.mockReset()
    mockActivateWallet.mockReset()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  it('does not disconnect when the connected trigger is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    mockWalletState({
      isConnected: true,
      publicKey: TEST_PUBLIC_KEY,
      network: 'TESTNET',
      selectedWallet: { name: 'Freighter', id: 'freighter', type: 'freighter' },
    })

    render(<WalletConnectButton />)

    await user.click(screen.getByRole('button', { name: 'Open wallet menu' }))

    expect(mockDisconnect).not.toHaveBeenCalled()
    expect(screen.getByText(TEST_PUBLIC_KEY)).toBeInTheDocument()
  })

  it('copies the full address when Copy address is chosen', async () => {
    const user = userEvent.setup({ delay: null })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    mockWalletState({
      isConnected: true,
      publicKey: TEST_PUBLIC_KEY,
      network: 'TESTNET',
    })

    render(<WalletConnectButton />)

    await user.click(screen.getByRole('button', { name: 'Open wallet menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Copy address' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(TEST_PUBLIC_KEY)
      expect(toast.success).toHaveBeenCalledWith(
        'Wallet address copied to clipboard'
      )
    })
    expect(toast.error).not.toHaveBeenCalled()
    expect(mockDisconnect).not.toHaveBeenCalled()
  })

  it('disconnects only when Disconnect is chosen', async () => {
    const user = userEvent.setup({ delay: null })
    mockWalletState({
      isConnected: true,
      publicKey: TEST_PUBLIC_KEY,
      network: 'TESTNET',
    })

    render(<WalletConnectButton />)

    await user.click(screen.getByRole('button', { name: 'Open wallet menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Disconnect' }))

    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Wallet disconnected')
  })

  it('calls connect when Connect Wallet is clicked', async () => {
    const user = userEvent.setup({ delay: null })
    mockConnect.mockResolvedValue(true)
    mockWalletState({ isConnected: false })

    render(<WalletConnectButton />)

    await user.click(screen.getByRole('button', { name: 'Connect Wallet' }))

    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockDisconnect).not.toHaveBeenCalled()
  })
})
