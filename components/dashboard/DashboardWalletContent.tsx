'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import { useUserByUsername } from '@/hooks/convex'
import { WalletSettings } from '@/components/stellar'

export function DashboardWalletContent() {
  const { user: currentUser } = useAuth()
  const user = useUserByUsername(currentUser?.username)
  const [localWalletAddress, setLocalWalletAddress] = useState<
    string | null | undefined
  >()

  useEffect(() => {
    if (user?.stellarAddress !== localWalletAddress) {
      setLocalWalletAddress(user?.stellarAddress)
    }
  }, [user?.stellarAddress, localWalletAddress])

  if (!currentUser?.username || user === undefined) {
    return null
  }

  const profileDisplayName = user?.name || currentUser.username

  return (
    <div className="space-y-8">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Wallet Management
        </h2>
        <p className="text-muted-foreground">
          Manage your Stellar wallet for sending and receiving tips.
        </p>
      </div>

      <div className="max-w-2xl">
        <WalletSettings
          walletAddress={localWalletAddress ?? user?.stellarAddress}
          profileUsername={currentUser.username}
          isOwnProfile
          profileDisplayName={profileDisplayName}
          onAddressChange={(address) => {
            setLocalWalletAddress(address || undefined)
          }}
        />
      </div>
    </div>
  )
}
