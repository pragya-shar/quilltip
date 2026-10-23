'use client'

import { useEffect, useState } from 'react'
import { WalletSettings } from '@/components/stellar'
import { ActivityBoundary } from '@/components/account/ActivityBoundary'
import type { CurrentUserDoc } from '@/types/convex'
import { WalletActivity } from '@/components/dashboard/WalletActivity'

export function WalletAccountContent({ user }: { user: CurrentUserDoc }) {
  const [localAddress, setLocalAddress] = useState<string | null | undefined>()
  useEffect(() => {
    if (
      localAddress !== undefined &&
      (user.stellarAddress ?? null) === localAddress
    )
      setLocalAddress(undefined)
  }, [user.stellarAddress, localAddress])
  return (
    <>
      <div className="account-heading">
        <h1>Wallet</h1>
        <p>Your wallet and tip activity.</p>
      </div>
      <div className="account-wallet">
        <WalletSettings
          walletAddress={
            localAddress === undefined ? user.stellarAddress : localAddress
          }
          profileUsername={user.username}
          isOwnProfile
          profileDisplayName={user.name || user.username}
          onAddressChange={setLocalAddress}
        />
        <ActivityBoundary resetKey={user._id}>
          <WalletActivity />
        </ActivityBoundary>
      </div>
    </>
  )
}
