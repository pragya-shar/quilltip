'use client'

import Link from 'next/link'
import { Wallet } from 'lucide-react'
import { useMyEarningsSummary } from '@/hooks/convex'
import {
  isTestnetValue,
  networkLabelLowercase,
} from '@/lib/copy/network-status'
import { CompactEarningsFigures } from '@/components/dashboard/CompactEarningsFigures'
import type { CurrentUserDoc } from '@/types/convex'
import { Skeleton } from '@/components/ui/skeleton'

type CompactEarningsCardProps = {
  user: CurrentUserDoc
}

export function CompactEarningsCard({ user }: CompactEarningsCardProps) {
  const earnings = useMyEarningsSummary()
  const hasWallet = Boolean(user.stellarAddress)

  if (earnings === undefined) {
    return (
      <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] shadow-[var(--card-shadow)]">
        <Skeleton className="mb-3 h-4 w-24" />
        <Skeleton className="mb-2 h-8 w-20" />
        <Skeleton className="h-4 w-32" />
      </div>
    )
  }

  if (!hasWallet) {
    return (
      <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] shadow-[var(--card-shadow)]">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          Wallet
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          Add a Stellar {networkLabelLowercase()} receiving wallet so published
          articles are ready to earn tips.
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            href="/dashboard/wallet"
            className="text-sm font-medium text-primary hover:text-foreground"
          >
            Set up wallet
          </Link>
          <Link
            href="/wallet/practice#wallet-help"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Wallet setup help
          </Link>
        </div>
      </div>
    )
  }

  // The lifetime totals once the row is rebuilt (#552), the previous figures
  // until then.
  const shown = earnings?.lifetime ?? earnings
  return (
    <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] shadow-[var(--card-shadow)]">
      <CompactEarningsFigures
        earnedStroops={shown?.earnedStroops ?? '0'}
        estimatedUsd={shown?.estimatedUsd ?? 0}
        tipCount={shown?.tipCount ?? 0}
        isTestnet={earnings ? earnings.network !== 'MAINNET' : isTestnetValue()}
        complete={earnings?.lifetime ? true : (earnings?.complete ?? true)}
        unpricedTipCount={shown?.unpricedTipCount ?? 0}
        updating={earnings?.updating ?? false}
      />
    </div>
  )
}
