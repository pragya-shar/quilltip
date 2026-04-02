'use client'

import { Coins, Clock, DollarSign, Wallet } from 'lucide-react'
import type { Doc } from '@/types/convex'
import { MonthlyEarningsChart } from '@/components/dashboard/monthly-earnings-chart'
import { TopEarningArticles } from '@/components/dashboard/top-earning-articles'
import {
  WalletSetupNotice,
  navigateToWalletTab,
} from '@/components/dashboard/wallet-setup-notice'

export type EarningsStatsProps = {
  earnings: Doc<'authorEarnings'>
  userProfile: { stellarAddress?: string | null } | null | undefined
  minWithdrawalUsd: number
  onOpenWithdrawModal: () => void
}

export function EarningsStats({
  earnings,
  userProfile,
  minWithdrawalUsd,
  onOpenWithdrawModal,
}: EarningsStatsProps) {
  const lastWithdrawal = earnings.lastWithdrawalAt
  const belowWithdrawalMinimum =
    earnings.availableBalanceUsd < minWithdrawalUsd
  const showMinimumWithdrawalHelper =
    belowWithdrawalMinimum && Boolean(userProfile?.stellarAddress)

  return (
    <>
      {userProfile && !userProfile.stellarAddress && <WalletSetupNotice />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600">Total Earned</span>
            <DollarSign className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            ${earnings.totalEarnedUsd.toFixed(2)}
          </p>
          <p className="text-sm text-gray-500 mt-1">
            {earnings.tipCount} tips received
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600">Available Balance</span>
            <Coins className="w-5 h-5 text-yellow-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            ${earnings.availableBalanceUsd.toFixed(2)}
          </p>
          <button
            type="button"
            onClick={() => {
              if (!userProfile?.stellarAddress) {
                navigateToWalletTab()
              } else {
                onOpenWithdrawModal()
              }
            }}
            disabled={earnings.availableBalanceUsd < minWithdrawalUsd}
            className="mt-3 w-full px-3 py-1.5 bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-sm rounded-lg hover:from-yellow-500 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <Wallet className="w-4 h-4" />
            {!userProfile?.stellarAddress ? 'Set Up Wallet' : 'Withdraw'}
          </button>
          {showMinimumWithdrawalHelper && (
            <p className="mt-2 text-sm text-gray-500">
              Withdrawals require a minimum available balance of $
              {minWithdrawalUsd.toFixed(2)}. Add earnings until your balance
              reaches this amount.
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-600">Total Withdrawn</span>
            <Clock className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-2xl font-bold text-gray-900">
            ${earnings.withdrawnUsd.toFixed(2)}
          </p>
          {lastWithdrawal && (
            <p className="text-sm text-gray-500 mt-1">
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
