'use client'

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'

type WalletActivationContextValue = {
  isWalletActive: boolean
  activateWallet: () => void
}

const WalletActivationContext =
  createContext<WalletActivationContextValue | undefined>(undefined)

export function WalletActivationProvider({ children }: { children: ReactNode }) {
  const [isWalletActive, setIsWalletActive] = useState(false)
  const activateWallet = useCallback(() => setIsWalletActive(true), [])

  return (
    <WalletActivationContext.Provider
      value={{ isWalletActive, activateWallet }}
    >
      {children}
    </WalletActivationContext.Provider>
  )
}

export function useWalletActivation(): WalletActivationContextValue {
  const context = useContext(WalletActivationContext)
  if (context === undefined) {
    throw new Error(
      'useWalletActivation must be used within WalletActivationProvider'
    )
  }
  return context
}
