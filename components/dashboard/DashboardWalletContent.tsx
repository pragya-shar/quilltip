'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import { WalletSettings } from '@/components/stellar'
import { DashboardWalletSkeleton } from '@/components/dashboard/DashboardWalletSkeleton'
import { ActivityBoundary } from '@/components/account/ActivityBoundary'
import { WalletTipHistory } from '@/components/account/WalletTipHistory'
import { useTipActivity } from '@/hooks/convex/useTipActivity'
import type { CurrentUserDoc } from '@/types/convex'

function WalletActivity() {
  const activity = useTipActivity()
  if (activity.status === 'loading')
    return (
      <section
        className="account-tip-history"
        aria-labelledby="tip-history-title"
      >
        <h2 id="tip-history-title">Tip history</h2>
        <p role="status" className="account-muted">
          Loading your tips…
        </p>
      </section>
    )
  return <WalletTipHistory items={activity.items} />
}

function WalletAccountContent({ user }: { user: CurrentUserDoc }) {
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

export function DashboardWalletContent() {
  const { user } = useAuth()
  if (!user) return <DashboardWalletSkeleton />
  // Remount drafts, optimistic address state, and receipts together on account change.
  return <WalletAccountContent key={user._id} user={user} />
}
