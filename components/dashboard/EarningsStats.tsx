'use client'

import { Coins, DollarSign } from 'lucide-react'
import type { Doc } from '@/types/convex'
import { ContextualWalletSetup } from '@/components/stellar/ContextualWalletSetup'
import { MonthlyEarningsChart } from '@/components/dashboard/monthly-earnings-chart'
import { TopEarningArticles } from '@/components/dashboard/top-earning-articles'
import { networkLabelLowercase } from '@/lib/copy/network-status'
import { Card, CardContent } from '@/components/ui/card'

export type EarningsStatsProps = {
  earnings: Doc<'authorEarnings'>
  userProfile: { stellarAddress?: string | null } | null | undefined
}

export function EarningsStats({ earnings, userProfile }: EarningsStatsProps) {
  return (
    <>
      {userProfile && !userProfile.stellarAddress && (
        <ContextualWalletSetup mode="receive" />
      )}

      <Card variant="quiet">
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
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

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-muted-foreground">Available Balance</span>
                <Coins className="w-5 h-5 text-warning-foreground" />
              </div>
              <p className="text-2xl font-bold text-foreground">
                ${earnings.availableBalanceUsd.toFixed(2)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <MonthlyEarningsChart monthlyEarnings={earnings.monthlyEarnings ?? {}} />

      {earnings.topArticles && earnings.topArticles.length > 0 && (
        <TopEarningArticles articles={earnings.topArticles} />
      )}
    </>
  )
}
