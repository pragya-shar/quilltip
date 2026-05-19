'use client'

import { createContext, useContext, useEffect, type ReactNode } from 'react'
import {
  useStellarWallet,
  StellarWalletState,
  StellarWalletActions,
} from '@/hooks/useStellarWallet'
import { useWalletActivation } from './WalletActivationContext'

type WalletContextType = StellarWalletState & StellarWalletActions

const WalletContext = createContext<WalletContextType | undefined>(undefined)

const INACTIVE_WALLET_STUB: WalletContextType = {
  isInstalled: false,
  isConnected: false,
  isLoading: false,
  publicKey: null,
  network: null,
  networkPassphrase: null,
  error: null,
  selectedWallet: null,
  connect: async () => false,
  disconnect: () => {},
  signTransaction: async () => {
    throw new Error('Wallet not activated')
  },
  refreshConnection: async () => {},
}

const LOADING_WALLET_STUB: WalletContextType = {
  ...INACTIVE_WALLET_STUB,
  isLoading: true,
}

interface WalletProviderProps {
  children: ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
  const wallet = useStellarWallet()

  return (
    <WalletContext.Provider value={wallet}>{children}</WalletContext.Provider>
  )
}

type UseWalletOptions = {
  /** Load wallet subsystem when this component mounts (profile, wallet settings). */
  activateOnMount?: boolean
}

export function useWallet(options?: UseWalletOptions): WalletContextType {
  const { isWalletActive, activateWallet } = useWalletActivation()
  const context = useContext(WalletContext)

  useEffect(() => {
    if (options?.activateOnMount) {
      activateWallet()
    }
  }, [options?.activateOnMount, activateWallet])

  if (!isWalletActive) {
    return {
      ...INACTIVE_WALLET_STUB,
      connect: async () => {
        activateWallet()
        return false
      },
    }
  }

  if (context === undefined) {
    return LOADING_WALLET_STUB
  }

  return context
}
