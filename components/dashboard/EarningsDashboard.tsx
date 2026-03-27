'use client'

import { useState } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import {
  useAuthorEarnings,
  useUserByUsername,
  useUserReceivedTips,
} from '@/hooks/convex'
import { Coins } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { useAuth } from '@/components/providers/AuthContext'
import { MIN_WITHDRAWAL_USD } from '@/lib/constants'
import { TipHistory } from '@/components/dashboard/TipHistory'
import { WithdrawalDialog } from '@/components/dashboard/WithdrawalDialog'
import { EarningsStats } from '@/components/dashboard/EarningsStats'

export function EarningsDashboard() {
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)

  const { user: currentUser } = useAuth()

  // Fetch earnings data
  const earnings = useAuthorEarnings()
  const recentTips = useUserReceivedTips()
  const userProfile = useUserByUsername(currentUser?.username)

  // Withdrawal mutations
  const withdrawEarnings = useMutation(api.tips.withdrawEarnings)

  const handleWithdrawFromDialog = async (args: {
    amountUsd: number
    stellarAddress: string
  }) => {
    try {
      await withdrawEarnings({
        amountUsd: args.amountUsd,
        stellarAddress: args.stellarAddress,
      })
      toast.success(
        `Withdrawal initiated! $${args.amountUsd.toFixed(2)} will be sent to your Stellar wallet shortly.`
      )
    } catch (error) {
      console.error('Withdrawal error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to process withdrawal'
      )
      throw error
    }
  }

  // Loading state
  if (earnings === undefined || recentTips === undefined) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6">
              <Skeleton className="h-4 w-24 mb-4" />
              <Skeleton className="h-8 w-20 mb-2" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // No earnings yet
  if (!earnings) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Coins className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No earnings yet
          </h3>
          <p className="text-gray-600">
            Start earning by sharing great content that readers love!
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <EarningsStats
        earnings={earnings}
        userProfile={userProfile}
        minWithdrawalUsd={MIN_WITHDRAWAL_USD}
        onOpenWithdrawModal={() => setShowWithdrawModal(true)}
      />

      <TipHistory tips={recentTips} />

      <WithdrawalDialog
        open={showWithdrawModal}
        onOpenChange={setShowWithdrawModal}
        availableBalanceUsd={earnings.availableBalanceUsd}
        minWithdrawalUsd={MIN_WITHDRAWAL_USD}
        savedStellarAddress={userProfile?.stellarAddress}
        onWithdraw={handleWithdrawFromDialog}
      />
    </div>
  )
}
