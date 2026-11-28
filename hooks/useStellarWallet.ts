'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { wallet, type WalletConnection } from '@/lib/stellar/v2/wallet-kit'
import { useAuth } from '@/components/providers/AuthContext'
import {
  REMEMBERED_WALLET_PREFIX,
  type RememberedWallet,
} from '@/lib/wallet/remembered-wallet'
import { walletDisplayName } from '@/lib/stellar/wallet-catalog'
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

/** The reader's remembered wallet while it is not connected (#562). */
export interface LastUsedWallet {
  walletId: string
  walletName: string
  address: string
}

export interface StellarWalletState {
  isInstalled: boolean
  isConnected: boolean
  isLoading: boolean
  /**
   * Checking, without a prompt, whether the reader's last wallet can
   * reconnect after a page load. It does not set `isLoading`, so nothing
   * that waits on the wallet waits on the restore.
   */
  isRestoring: boolean
  /**
   * The signed-in reader's remembered wallet when it did not reconnect (it
   * would need a prompt, or it is on another account), shown as last used.
   */
  lastUsed: LastUsedWallet | null
  publicKey: string | null
  network: string | null
  networkPassphrase: string | null
  /** False when the wallet cannot report its network (Quilltip's is assumed). */
  networkReported: boolean
  error: string | null
  errorKind: WalletErrorKind | null
  selectedWallet: WalletInfo | null
}

export interface StellarWalletActions {
  /**
   * Opens Quilltip's wallet picker. Resolves true once connected, false when
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
    lastUsed: null,
  } satisfies Partial<StellarWalletState>
}

function lastUsedOf(record: RememberedWallet | null): LastUsedWallet | null {
  return record
    ? {
        walletId: record.walletId,
        walletName: walletDisplayName(record.walletId, 'Wallet'),
        address: record.address,
      }
    : null
}

export function useStellarWallet(): StellarWalletState & StellarWalletActions {
  const [state, setState] = useState<StellarWalletState>(() => {
    const connection = wallet.getConnection()
    return {
      isInstalled: false,
      isLoading: false,
      isRestoring: false,
      lastUsed: null,
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
      lastUsed: null,
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
              return { ...prev, ...DISCONNECTED, lastUsed: null }
          }
        })
      }),
    []
  )

  // Restore (#562): while a reader is signed in, reconnect their last wallet
  // only when it still reports the remembered address without a prompt.
  // Otherwise it stays disconnected and is shown as last used. Signing out,
  // or another reader signing in, forgets the previous reader's choice and
  // connection.
  const { user, isAuthenticated, isLoading: authLoading } = useAuth()
  const userId = isAuthenticated ? (user?._id ?? null) : null
  const signedInAs = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (authLoading || (isAuthenticated && !userId)) return
    const previous = signedInAs.current
    signedInAs.current = userId
    // Forgets under the previous reader's key, before it changes.
    if (previous && previous !== userId) disconnect()
    wallet.setRemembering(userId)
    if (!userId) {
      setState((prev) => ({ ...prev, lastUsed: null }))
      return
    }
    if (wallet.getConnection()) return
    setState((prev) =>
      prev.isConnected ? prev : { ...prev, isRestoring: true }
    )
    void wallet.restore().finally(() => {
      setState((prev) => ({
        ...prev,
        isRestoring: false,
        lastUsed: prev.isConnected
          ? null
          : lastUsedOf(wallet.rememberedWallet()),
      }))
    })
  }, [authLoading, isAuthenticated, userId, disconnect])

  // Disconnect or sign-out in another tab removes the remembered wallet:
  // this tab lets go of it too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(REMEMBERED_WALLET_PREFIX))
        return
      if (wallet.rememberedWallet()) return
      if (wallet.getConnection()) disconnect()
      else setState((prev) => ({ ...prev, lastUsed: null }))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [disconnect])

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
