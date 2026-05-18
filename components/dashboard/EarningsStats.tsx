'use client'

import type { RefObject } from 'react'
import { Coins, Clock, DollarSign, Wallet } from 'lucide-react'
import type { Doc } from '@/types/convex'
import { MonthlyEarningsChart } from '@/components/dashboard/monthly-earnings-chart'
import { TopEarningArticles } from '@/components/dashboard/top-earning-articles'
import {
  WalletSetupNotice,
  navigateToWalletTab,
} from '@/components/dashboard/wallet-setup-notice'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TESTNET_PRACTICE_NOTE } from '@/lib/copy/network-status'

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
  const lastWithdrawal = earnings.lastWithdrawalAt
  const belowWithdrawalMinimum = earnings.availableBalanceUsd < minWithdrawalUsd
  const showMinimumWithdrawalHelper =
    belowWithdrawalMinimum && Boolean(userProfile?.stellarAddress)

  return (
    <>
      <Alert className="border-border bg-muted/60">
        <AlertDescription className="text-sm text-muted-foreground">
          {TESTNET_PRACTICE_NOTE}
        </AlertDescription>
      </Alert>

      {userProfile && !userProfile.stellarAddress && <WalletSetupNotice />}

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
            {earnings.tipCount} testnet tips received
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
                navigateToWalletTab()
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
              Testnet withdrawals require a minimum available balance of $
              {minWithdrawalUsd.toFixed(2)}. Add testnet tips until your balance
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

      {earnings.monthlyEarnings && (
        <MonthlyEarningsChart monthlyEarnings={earnings.monthlyEarnings} />
      )}

      {earnings.topArticles && earnings.topArticles.length > 0 && (
        <TopEarningArticles articles={earnings.topArticles} />
      )}
    </>
  )
}
