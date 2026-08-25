'use client'

import { useAuth } from '@/components/providers/AuthContext'
import {
  useAuthorEarnings,
  useUserByUsername,
  useUserStats,
} from '@/hooks/convex'
import { CreatorStatsPanel } from '@/components/dashboard/CreatorStatsPanel'
import { DashboardStatsSkeleton } from '@/components/dashboard/DashboardStatsSkeleton'

export function DashboardStatsContent() {
  const { user: currentUser } = useAuth()
  const user = useUserByUsername(currentUser?.username)
  const userStats = useUserStats(user?._id)
  const earnings = useAuthorEarnings()

  if (!currentUser || user === null) {
    return null
  }

  if (user === undefined || userStats === undefined || earnings === undefined) {
    return <DashboardStatsSkeleton />
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">
          Creator Stats
        </h2>
        <p className="text-muted-foreground">
          Overview of your publishing activity and testnet tips.
        </p>
      </div>

      <CreatorStatsPanel
        articleCount={userStats?.articleCount ?? 0}
        tipsReceivedCount={userStats?.tipsReceivedCount ?? 0}
        totalEarnedUsd={earnings?.totalEarnedUsd ?? 0}
        nftsOwned={user?.nftsOwned ?? 0}
      />
    </div>
  )
}
