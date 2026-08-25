'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import { useUserByUsername } from '@/hooks/convex'
import { WalletSettings } from '@/components/stellar'
import { DashboardWalletSkeleton } from '@/components/dashboard/DashboardWalletSkeleton'

export function DashboardWalletContent() {
  const { user: currentUser } = useAuth()
  const user = useUserByUsername(currentUser?.username)
  const [localWalletAddress, setLocalWalletAddress] = useState<
    string | null | undefined
  >()

  useEffect(() => {
    if (
      localWalletAddress !== undefined &&
      user?.stellarAddress === localWalletAddress
    ) {
      setLocalWalletAddress(undefined)
    }
  }, [user?.stellarAddress, localWalletAddress])

  if (!currentUser?.username || user === undefined) {
    return <DashboardWalletSkeleton />
  }

  const profileDisplayName = user?.name || currentUser.username
  const walletAddress =
    localWalletAddress === undefined ? user?.stellarAddress : localWalletAddress

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
          walletAddress={walletAddress}
          profileUsername={currentUser.username}
          isOwnProfile
          profileDisplayName={profileDisplayName}
          onAddressChange={setLocalWalletAddress}
        />
      </div>
    </div>
  )
}
