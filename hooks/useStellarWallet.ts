'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  walletAdapter,
  WalletInfo,
  NO_WALLET_AVAILABLE_ERROR_CODE,
} from '@/lib/stellar/wallet-adapter'

export interface StellarWalletState {
  isInstalled: boolean
  isConnected: boolean
  isLoading: boolean
  publicKey: string | null
  network: string | null
  networkPassphrase: string | null
  error: string | null
  selectedWallet: WalletInfo | null // Currently selected wallet info
}

export interface StellarWalletActions {
  connect: () => Promise<boolean>
  disconnect: () => void
  signTransaction: (xdr: string) => Promise<string>
  refreshConnection: () => Promise<void>
}

export function useStellarWallet(): StellarWalletState & StellarWalletActions {
  const [state, setState] = useState<StellarWalletState>({
    isInstalled: false,
    isConnected: false,
    isLoading: true,
    publicKey: null,
    network: null,
    networkPassphrase: null,
    error: null,
    selectedWallet: null,
  })

  // Check if wallet is installed and connected
  // NOTE: This is a passive check that won't trigger wallet popups
  const checkWalletStatus = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      // Check if any wallet is available
      const walletInstalled = await walletAdapter.isInstalled()
      const walletConnected = await walletAdapter.isConnected()

      if (walletInstalled && walletConnected) {
        // Wallet was previously connected AND has cached details
        // Get cached details to avoid triggering wallet popups
        const selectedWallet = walletAdapter.getSelectedWallet()
        const cachedConnection = walletAdapter.getCachedConnection()

        if (cachedConnection) {
          // We have cached details, show as fully connected
          setState((prev) => ({
            ...prev,
            isInstalled: true,
            isConnected: true,
            isLoading: false,
            publicKey: cachedConnection.publicKey,
            network: cachedConnection.network,
            networkPassphrase: cachedConnection.networkPassphrase,
            selectedWallet,
            error: null,
          }))
        } else {
          // No cached details, treat as disconnected to avoid popups
          // User will need to explicitly reconnect
          setState((prev) => ({
            ...prev,
            isInstalled: walletInstalled,
            isConnected: false,
            isLoading: false,
            publicKey: null,
            network: null,
            networkPassphrase: null,
            selectedWallet: null,
            error: null,
          }))
        }
      } else {
        setState((prev) => ({
          ...prev,
          isInstalled: walletInstalled,
          isConnected: false,
          isLoading: false,
          publicKey: null,
          network: null,
          networkPassphrase: null,
          selectedWallet: null,
          error: null,
        }))
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown wallet error',
      }))
    }
  }, [])

  // Connect to wallet (opens wallet selection modal)
  const connect = useCallback(async (): Promise<boolean> => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))

      // Connect via wallet adapter (opens modal for wallet selection)
      const result = await walletAdapter.connect()

      // Update state with connection result
      const selectedWallet = walletAdapter.getSelectedWallet()

      setState((prev) => ({
        ...prev,
        isInstalled: true,
        isConnected: true,
        isLoading: false,
        publicKey: result.publicKey,
        network: result.network,
        networkPassphrase: result.networkPassphrase,
        selectedWallet,
        error: null,
      }))

      return true
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Connection failed'

      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }))

      if (message.startsWith(`${NO_WALLET_AVAILABLE_ERROR_CODE}:`)) {
        throw new Error(message)
      }
      return false
    }
  }, [])

  // Disconnect wallet (clear local state)
  const disconnect = useCallback(() => {
    walletAdapter.disconnect()

    setState((prev) => ({
      ...prev,
      isInstalled: true,
      isConnected: false,
      isLoading: false,
      publicKey: null,
      network: null,
      networkPassphrase: null,
      selectedWallet: null,
      error: null,
    }))
  }, [])

  // Sign transaction
  const signTransactionXDR = useCallback(
    async (xdr: string): Promise<string> => {
      // Get fresh connection status from adapter, not potentially stale React state
      const connection = walletAdapter.getCachedConnection()
      if (!connection) {
        throw new Error('Wallet not connected')
      }

      const signedXdr = await walletAdapter.signTransaction(
        xdr,
        connection.networkPassphrase
      )
      return signedXdr
    },
    []
  )

  // Refresh connection status
  const refreshConnection = useCallback(async () => {
    await checkWalletStatus()
  }, [checkWalletStatus])

  // Initialize wallet check on mount
  useEffect(() => {
    checkWalletStatus()
  }, [checkWalletStatus])

  // NOTE: Removed automatic wallet detail fetching to prevent unwanted popups
  // Wallet details are now only fetched:
  // 1. From cache during initial checkWalletStatus()
  // 2. When user explicitly clicks connect()
  // This ensures no popups appear without user interaction

  // Watch for wallet changes (account and network)
  useEffect(() => {
    if (!state.isInstalled || !state.isConnected) return

    // Watch for account changes
    const cleanupAccount = walletAdapter.watchAccountChanges((address) => {
      setState((prev) => ({
        ...prev,
        publicKey: address,
      }))
    })

    // Watch for network changes
    const cleanupNetwork = walletAdapter.watchNetworkChanges((network) => {
      setState((prev) => ({
        ...prev,
        network: network.network,
        networkPassphrase: network.networkPassphrase,
      }))
    })

    return () => {
      cleanupAccount()
      cleanupNetwork()
    }
  }, [state.isInstalled, state.isConnected])

  return {
    ...state,
    connect,
    disconnect,
    signTransaction: signTransactionXDR,
    refreshConnection,
  }
}
