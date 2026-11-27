'use client'

import { useAuth } from '@/components/providers/AuthContext'
import {
  useMyEarningsSummary,
  useUserByUsername,
  useUserStats,
} from '@/hooks/convex'
import { CreatorStatsPanel } from '@/components/dashboard/CreatorStatsPanel'
import { DashboardStatsSkeleton } from '@/components/dashboard/DashboardStatsSkeleton'
import { CollectPanelLoader } from '@/components/tab/CollectPanelLoader'

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

  // The lifetime totals once the row is rebuilt (#552), the previous figures
  // until then.
  const shown = earnings?.lifetime ?? earnings

  return (
    <div className="account-stats">
      <div className="account-heading">
        <h1>Stats</h1>
        <p>Overview of your publishing activity and testnet tips.</p>
      </div>

      <CreatorStatsPanel
        articleCount={userStats?.articleCount ?? 0}
        tipsReceivedCount={shown?.tipCount ?? 0}
        earnedStroops={shown?.earnedStroops ?? '0'}
        estimatedUsd={shown?.estimatedUsd ?? 0}
        isTestnet={earnings?.network !== 'MAINNET'}
        nftsOwned={user?.nftsOwned ?? 0}
        complete={earnings?.lifetime ? true : (earnings?.complete ?? true)}
        unpricedTipCount={shown?.unpricedTipCount ?? 0}
        updating={earnings?.updating ?? false}
        source={earnings?.lifetime ? 'lifetime' : 'previous'}
      />
      <CollectPanelLoader />
    </div>
  )
}
