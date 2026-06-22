'use client'

import dynamic from 'next/dynamic'
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  StellarWalletState,
  StellarWalletActions,
} from '@/hooks/useStellarWallet'
import { useWalletActivation } from './WalletActivationContext'

export type WalletContextType = StellarWalletState & StellarWalletActions

const WalletContext = createContext<WalletContextType | undefined>(undefined)

const LazyWalletRuntime = dynamic(
  () =>
    import('./WalletRuntime').then((mod) => ({
      default: mod.WalletRuntime,
    })),
  { ssr: false }
)

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
  const { isWalletActive, activateWallet } = useWalletActivation()
  const [activeWallet, setActiveWallet] = useState<WalletContextType | null>(
    null
  )

  const inactiveWallet = useMemo<WalletContextType>(
    () => ({
      ...INACTIVE_WALLET_STUB,
      connect: async () => {
        activateWallet()
        return false
      },
    }),
    [activateWallet]
  )

  const wallet = !isWalletActive
    ? inactiveWallet
    : (activeWallet ?? LOADING_WALLET_STUB)

  return (
    <WalletContext.Provider value={wallet}>
      {isWalletActive && <LazyWalletRuntime onWalletChange={setActiveWallet} />}
      {children}
    </WalletContext.Provider>
  )
}

type UseWalletOptions = {
  /** Load wallet subsystem when this component mounts (profile, wallet settings). */
  activateOnMount?: boolean
}

export function useWallet(options?: UseWalletOptions): WalletContextType {
  const { isWalletActive, activateWallet } = useWalletActivation()
  const context = useContext(WalletContext)
  const inactiveWallet = useMemo<WalletContextType>(
    () => ({
      ...INACTIVE_WALLET_STUB,
      connect: async () => {
        activateWallet()
        return false
      },
    }),
    [activateWallet]
  )

  useEffect(() => {
    if (options?.activateOnMount) {
      activateWallet()
    }
  }, [options?.activateOnMount, activateWallet])

  if (context === undefined) {
    if (!isWalletActive) return inactiveWallet
    return LOADING_WALLET_STUB
  }

  return context
}
