'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { wallet, type WalletConnection } from '@/lib/stellar/v2/wallet-kit'
import {
  isWalletError,
  type WalletErrorKind,
} from '@/lib/stellar/v2/wallet-errors'
import { openWalletPicker } from '@/lib/stellar/v2/wallet-picker'
import { setWalletPickerOpen } from '@/lib/stellar/wallet-picker-state'

export interface WalletInfo {
  id: string
  name: string
}

export interface StellarWalletState {
  isInstalled: boolean
  isConnected: boolean
  isLoading: boolean
  publicKey: string | null
  network: string | null
  networkPassphrase: string | null
  /** False when the wallet cannot report its network (QuillTip's is assumed). */
  networkReported: boolean
  error: string | null
  errorKind: WalletErrorKind | null
  selectedWallet: WalletInfo | null
}

export interface StellarWalletActions {
  /**
   * Opens QuillTip's wallet picker. Resolves true once connected, false when
   * the reader closes the picker; throws a `WalletError` for every other
   * failure. The picker opens without an extension too.
   */
  connect: () => Promise<boolean>
  disconnect: () => void
  signTransaction: (xdr: string) => Promise<string>
  refreshConnection: () => Promise<void>
}

const DISCONNECTED = {
  isConnected: false,
  publicKey: null,
  network: null,
  networkPassphrase: null,
  networkReported: false,
  selectedWallet: null,
} satisfies Partial<StellarWalletState>

function connectedState(connection: WalletConnection) {
  return {
    isInstalled: true,
    isConnected: true,
    publicKey: connection.address,
    network: connection.network || null,
    networkPassphrase: connection.networkPassphrase,
    networkReported: connection.networkReported,
    selectedWallet: { id: connection.walletId, name: connection.walletName },
  } satisfies Partial<StellarWalletState>
}

export function useStellarWallet(): StellarWalletState & StellarWalletActions {
  const [state, setState] = useState<StellarWalletState>(() => {
    const connection = wallet.getConnection()
    return {
      isInstalled: false,
      isLoading: false,
      error: null,
      errorKind: null,
      ...DISCONNECTED,
      ...(connection ? connectedState(connection) : {}),
    }
  })

  // Passive check: never prompts the wallet.
  const checkWalletStatus = useCallback(async () => {
    try {
      const isInstalled = await wallet.hasWallet()
      const connection = wallet.getConnection()
      setState((prev) => ({
        ...prev,
        isInstalled,
        ...(connection ? connectedState(connection) : DISCONNECTED),
      }))
    } catch {
      setState((prev) => ({ ...prev, isInstalled: false }))
    }
  }, [])

  const connect = useCallback(async (): Promise<boolean> => {
    // The picker shows its own waiting state; keep the trigger mounted so
    // focus returns to it when the picker closes.
    setState((prev) => ({ ...prev, error: null, errorKind: null }))
    try {
      // The picker opens without an extension too: it offers web wallets
      // (xBull, Albedo) and install links for the extensions.
      setWalletPickerOpen(true)
      let connection
      try {
        connection = await openWalletPicker()
      } finally {
        setWalletPickerOpen(false)
      }
      setState((prev) => ({
        ...prev,
        ...connectedState(connection),
        isLoading: false,
      }))
      return true
    } catch (error) {
      const kind = isWalletError(error) ? error.kind : 'failed'
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: kind === 'cancelled' ? null : (error as Error).message,
        errorKind: kind === 'cancelled' ? null : kind,
      }))
      if (kind === 'cancelled') return false
      throw error
    }
  }, [])

  const disconnect = useCallback(() => {
    void wallet.disconnect()
    setState((prev) => ({
      ...prev,
      ...DISCONNECTED,
      isLoading: false,
      error: null,
      errorKind: null,
    }))
  }, [])

  const signTransaction = useCallback(async (xdr: string) => {
    const { signedTxXdr } = await wallet.signTransaction(xdr)
    return signedTxXdr
  }, [])

  const refreshConnection = useCallback(async () => {
    try {
      await wallet.refreshNetwork()
    } catch (error) {
      if (!isWalletError(error, 'wrong-network')) throw error
    }
    await checkWalletStatus()
  }, [checkWalletStatus])

  useEffect(() => {
    void checkWalletStatus()
  }, [checkWalletStatus])

  // Kit events replace the 1.x polling.
  useEffect(
    () =>
      wallet.subscribe((event) => {
        setState((prev) => {
          switch (event.type) {
            case 'connected':
            case 'network':
              return { ...prev, ...connectedState(event.connection) }
            case 'account':
              return { ...prev, publicKey: event.address }
            case 'disconnected':
              return { ...prev, ...DISCONNECTED }
          }
        })
      }),
    []
  )

  // A wallet can switch networks while the page is open. Check again when the
  // reader comes back to the tab; the request does not prompt.
  useEffect(() => {
    if (!state.isConnected) return
    const recheck = () => {
      if (document.visibilityState !== 'visible') return
      void wallet.refreshNetwork().catch(() => {
        // `network` events carry the new passphrase; other failures surface
        // when the reader next signs.
      })
    }
    document.addEventListener('visibilitychange', recheck)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', recheck)
      window.removeEventListener('focus', recheck)
    }
  }, [state.isConnected])

  return useMemo(
    () => ({
      ...state,
      connect,
      disconnect,
      signTransaction,
      refreshConnection,
    }),
    [connect, disconnect, refreshConnection, signTransaction, state]
  )
}
