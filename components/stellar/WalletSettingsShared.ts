'use client'

export interface WalletSettingsProps {
  walletAddress?: string | null
  profileUsername?: string
  onAddressChange?: (address: string | null) => void
  isOwnProfile: boolean
  profileDisplayName?: string
  className?: string
}
