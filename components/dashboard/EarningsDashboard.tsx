'use client'

import { useRouter } from 'next/navigation'
import {
  useAuthorEarnings,
  useUserByUsername,
  useUserReceivedTips,
} from '@/hooks/convex'
import { Coins } from 'lucide-react'
import { useAuth } from '@/components/providers/AuthContext'
import { TipHistory } from '@/components/dashboard/TipHistory'
import { EarningsStats } from '@/components/dashboard/EarningsStats'
import { EarningsDashboardSkeleton } from '@/components/dashboard/EarningsDashboardSkeleton'
import { useDashboardNavigation } from '@/hooks/useDashboardNavigation'

export function EarningsDashboard() {
  const router = useRouter()
  const navigateToDashboard = useDashboardNavigation()

  const { user: currentUser } = useAuth()

  const earnings = useAuthorEarnings()
  const recentTips = useUserReceivedTips()
  const userProfile = useUserByUsername(currentUser?.username)

  if (earnings === undefined || recentTips === undefined) {
    return <EarningsDashboardSkeleton />
  }

  if (!earnings) {
    const hasWallet = Boolean(userProfile?.stellarAddress)
    const primaryLabel = hasWallet ? 'Write your first post' : 'Set up wallet'
    const primaryAction = () => {
      if (hasWallet) {
        router.push('/write')
      } else {
        navigateToDashboard('wallet')
      }
    }

    return (
      <div className="space-y-6">
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-8 sm:p-12 text-center">
          <Coins className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No testnet tips yet
          </h3>
          <p className="text-muted-foreground mx-auto max-w-md">
            Publish a post, share it with readers, and you’ll start seeing tips
            here. Set up a Stellar wallet so tips go straight to it.
          </p>
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={primaryAction}
              className="w-full sm:w-auto px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 inline-flex items-center justify-center"
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <EarningsStats earnings={earnings} userProfile={userProfile} />

      <TipHistory tips={recentTips} />
    </div>
  )
}
