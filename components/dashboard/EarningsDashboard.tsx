'use client'

import { useState, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useRouter } from 'next/navigation'
import {
  useAuthorEarnings,
  useUserByUsername,
  useUserReceivedTips,
} from '@/hooks/convex'
import { Coins } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/components/providers/AuthContext'
import { MIN_WITHDRAWAL_USD } from '@/lib/constants'
import { TipHistory } from '@/components/dashboard/TipHistory'
import { WithdrawalDialog } from '@/components/dashboard/WithdrawalDialog'
import { EarningsStats } from '@/components/dashboard/EarningsStats'
import { EarningsDashboardSkeleton } from '@/components/dashboard/EarningsDashboardSkeleton'
import { withdrawalFlowNote } from '@/lib/copy/network-status'
import { useProfileTabNavigation } from '@/hooks/useProfileTabNavigation'

export function EarningsDashboard() {
  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const withdrawTriggerRef = useRef<HTMLButtonElement>(null)
  const router = useRouter()
  const navigateToTab = useProfileTabNavigation()

  const { user: currentUser } = useAuth()

  const earnings = useAuthorEarnings()
  const recentTips = useUserReceivedTips()
  const userProfile = useUserByUsername(currentUser?.username)

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
        `Withdrawal requested for $${args.amountUsd.toFixed(2)}. ${withdrawalFlowNote()}`
      )
    } catch (error) {
      console.error('Withdrawal error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Failed to process withdrawal'
      )
      throw error
    }
  }

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
        navigateToTab('wallet')
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
            here. Set up a Stellar wallet so you can withdraw your earnings when
            you’re ready.
          </p>
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={primaryAction}
              className="w-full sm:w-auto px-4 py-2 bg-brand text-brand-foreground rounded-lg hover:bg-brand-hover inline-flex items-center justify-center"
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
      <EarningsStats
        earnings={earnings}
        userProfile={userProfile}
        minWithdrawalUsd={MIN_WITHDRAWAL_USD}
        onOpenWithdrawModal={() => setShowWithdrawModal(true)}
        withdrawTriggerRef={withdrawTriggerRef}
      />

      <TipHistory tips={recentTips} />

      <WithdrawalDialog
        open={showWithdrawModal}
        onOpenChange={setShowWithdrawModal}
        availableBalanceUsd={earnings.availableBalanceUsd}
        minWithdrawalUsd={MIN_WITHDRAWAL_USD}
        savedStellarAddress={userProfile?.stellarAddress}
        onWithdraw={handleWithdrawFromDialog}
        triggerRef={withdrawTriggerRef}
      />
    </div>
  )
}
