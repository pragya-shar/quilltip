'use client'

import { useSyncExternalStore } from 'react'
import {
  getWalletPickerOpen,
  subscribeWalletPickerOpen,
} from '@/lib/stellar/wallet-picker-state'
import { useWallet } from '@/components/providers/WalletProvider'

function subscribe(listener: () => void) {
  return subscribeWalletPickerOpen(listener)
}

function getSnapshot() {
  return getWalletPickerOpen()
}

function getServerSnapshot() {
  return false
}

/**
 * Radix modal dialogs mark sibling nodes inert, which blocks clicks on the
 * Stellar Wallets Kit picker. Parent dialogs should pass modal={false} while
 * this hook returns true.
 */
export function useSuspendDialogModalForWallet(): boolean {
  const walletPickerOpen = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  )
  const { isLoading: isWalletLoading } = useWallet()
  return walletPickerOpen || isWalletLoading
}
