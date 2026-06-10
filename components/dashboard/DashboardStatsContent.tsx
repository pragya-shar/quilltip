'use client'

import { useAuth } from '@/components/providers/AuthContext'
import { useUserByUsername, useUserStats } from '@/hooks/convex'
import { CreatorStatsPanel } from '@/components/dashboard/CreatorStatsPanel'

export function DashboardStatsContent() {
  const { user: currentUser } = useAuth()
  const user = useUserByUsername(currentUser?.username)
  const userStats = useUserStats(user?._id)

  if (!currentUser || user === undefined) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-2">Creator Stats</h2>
        <p className="text-muted-foreground">
          Overview of your publishing activity and testnet tips.
        </p>
      </div>

      <CreatorStatsPanel
        articleCount={userStats?.articleCount ?? 0}
        tipsReceivedCount={userStats?.tipsReceivedCount ?? 0}
        nftsOwned={user?.nftsOwned ?? 0}
      />
    </div>
  )
}
