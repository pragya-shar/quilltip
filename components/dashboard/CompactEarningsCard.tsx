'use client'

import Link from 'next/link'
import { Coins, Wallet } from 'lucide-react'
import { useMyEarningsSummary } from '@/hooks/convex'
import {
  TESTNET_NO_VALUE_NOTE,
  earningsLabel,
  formatUsd,
  formatXlmFromStroops,
  isTestnetValue,
  networkLabelLowercase,
} from '@/lib/copy/network-status'
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

  const tipCount = earnings?.tipCount ?? 0
  const isTestnet = earnings ? earnings.network !== 'MAINNET' : isTestnetValue()
  const usdEstimate = `≈ ${formatUsd(earnings?.estimatedUsd ?? 0)}`

  return (
    <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] shadow-[var(--card-shadow)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {isTestnet ? 'Earned (testnet)' : earningsLabel()}
        </span>
        <Coins className="h-4 w-4 text-success-foreground" aria-hidden />
      </div>
      <p className="text-2xl font-bold text-foreground tabular-nums">
        {formatXlmFromStroops(earnings?.writerShareStroops ?? '0', 2)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {isTestnet ? `${usdEstimate}, ${TESTNET_NO_VALUE_NOTE}` : usdEstimate}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {tipCount} {networkLabelLowercase()} tip{tipCount === 1 ? '' : 's'}{' '}
        received
      </p>
    </div>
  )
}
