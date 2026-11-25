'use client'

import { useAuth } from '@/components/providers/AuthContext'
import {
  useMyEarningsSummary,
  useUserByUsername,
  useUserStats,
} from '@/hooks/convex'
import { CreatorStatsPanel } from '@/components/dashboard/CreatorStatsPanel'
import { DashboardStatsSkeleton } from '@/components/dashboard/DashboardStatsSkeleton'

export function DashboardStatsContent() {
  const { user: currentUser } = useAuth()
  const user = useUserByUsername(currentUser?.username)
  const userStats = useUserStats(user?._id)
  const earnings = useMyEarningsSummary()

  if (!currentUser || user === null) {
    return null
  }

  if (user === undefined || userStats === undefined || earnings === undefined) {
    return <DashboardStatsSkeleton />
  }

  return (
    <div className="account-stats">
      <div className="account-heading">
        <h1>Stats</h1>
        <p>Overview of your publishing activity and testnet tips.</p>
      </div>

      <CreatorStatsPanel
        articleCount={userStats?.articleCount ?? 0}
        tipsReceivedCount={userStats?.tipsReceivedCount ?? 0}
        earnedStroops={earnings?.writerShareStroops ?? '0'}
        estimatedUsd={earnings?.estimatedUsd ?? 0}
        isTestnet={earnings?.network !== 'MAINNET'}
        nftsOwned={user?.nftsOwned ?? 0}
      />
    </div>
  )
}
