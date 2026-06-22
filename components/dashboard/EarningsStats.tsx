'use client'

import type { RefObject } from 'react'
import { Coins, Clock, DollarSign, Wallet } from 'lucide-react'
import type { Doc } from '@/types/convex'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import { MonthlyEarningsChart } from '@/components/dashboard/monthly-earnings-chart'
import { TopEarningArticles } from '@/components/dashboard/top-earning-articles'
import { useDashboardNavigation } from '@/hooks/useDashboardNavigation'
import { networkLabelLowercase } from '@/lib/copy/network-status'

export type EarningsStatsProps = {
  earnings: Doc<'authorEarnings'>
  userProfile: { stellarAddress?: string | null } | null | undefined
  minWithdrawalUsd: number
  onOpenWithdrawModal: () => void
  withdrawTriggerRef?: RefObject<HTMLButtonElement | null>
}

export function EarningsStats({
  earnings,
  userProfile,
  minWithdrawalUsd,
  onOpenWithdrawModal,
  withdrawTriggerRef,
}: EarningsStatsProps) {
  const navigateToDashboard = useDashboardNavigation()
  const lastWithdrawal = earnings.lastWithdrawalAt
  const belowWithdrawalMinimum = earnings.availableBalanceUsd < minWithdrawalUsd
  const showMinimumWithdrawalHelper =
    belowWithdrawalMinimum && Boolean(userProfile?.stellarAddress)

  return (
    <>
      {userProfile && !userProfile.stellarAddress && (
        <ContextualWalletSetup mode="receive" />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Total Earned</span>
            <DollarSign className="w-5 h-5 text-success-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${earnings.totalEarnedUsd.toFixed(2)}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {earnings.tipCount} {networkLabelLowercase()} tips received
          </p>
        </div>

        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Available Balance</span>
            <Coins className="w-5 h-5 text-warning-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${earnings.availableBalanceUsd.toFixed(2)}
          </p>
          <button
            ref={withdrawTriggerRef}
            type="button"
            onClick={() => {
              if (!userProfile?.stellarAddress) {
                navigateToDashboard('wallet')
              } else {
                onOpenWithdrawModal()
              }
            }}
            disabled={earnings.availableBalanceUsd < minWithdrawalUsd}
            className="mt-3 w-full px-3 py-1.5 bg-brand text-brand-foreground text-sm rounded-lg hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" />
            {!userProfile?.stellarAddress ? 'Set Up Wallet' : 'Withdraw'}
          </button>
          {showMinimumWithdrawalHelper && (
            <p className="mt-2 text-sm text-muted-foreground">
              Withdrawals require a minimum available balance of $
              {minWithdrawalUsd.toFixed(2)}. Add more tips until your balance
              reaches this amount.
            </p>
          )}
        </div>

        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Total Withdrawn</span>
            <Clock className="w-5 h-5 text-info-foreground" />
          </div>
          <p className="text-2xl font-bold text-foreground">
            ${earnings.withdrawnUsd.toFixed(2)}
          </p>
          {lastWithdrawal && (
            <p className="text-sm text-muted-foreground mt-1">
              Last: {new Date(lastWithdrawal).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      <MonthlyEarningsChart monthlyEarnings={earnings.monthlyEarnings ?? {}} />

      {earnings.topArticles && earnings.topArticles.length > 0 && (
        <TopEarningArticles articles={earnings.topArticles} />
      )}
    </>
  )
}
