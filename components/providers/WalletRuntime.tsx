'use client'

import { useEffect } from 'react'
import { useStellarWallet } from '@/hooks/useStellarWallet'
import type { WalletContextType } from './WalletProvider'

interface WalletRuntimeProps {
  onWalletChange: (wallet: WalletContextType | null) => void
}

export function WalletRuntime({ onWalletChange }: WalletRuntimeProps) {
  const wallet = useStellarWallet()

  useEffect(() => {
    onWalletChange(wallet)
  }, [onWalletChange, wallet])

  useEffect(() => {
    return () => onWalletChange(null)
  }, [onWalletChange])

  return null
}
