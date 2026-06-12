'use client'

import Link from 'next/link'
import { DollarSign, Wallet } from 'lucide-react'
import { useAuthorEarnings } from '@/hooks/convex'
import { networkLabelLowercase } from '@/lib/copy/network-status'
import type { CurrentUserDoc } from '@/types/convex'
import { Skeleton } from '@/components/ui/skeleton'

type CompactEarningsCardProps = {
  user: CurrentUserDoc
}

export function CompactEarningsCard({ user }: CompactEarningsCardProps) {
  const earnings = useAuthorEarnings()
  const hasWallet = Boolean(user.stellarAddress)
  const username = user.username

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
          Set up a Stellar {networkLabelLowercase()} wallet to receive tips from
          readers.
        </p>
        <Link
          href="/guide"
          className="text-sm font-medium text-brand-blue hover:text-brand-accent"
        >
          Set up wallet
        </Link>
      </div>
    )
  }

  const totalEarned = earnings?.totalEarnedUsd ?? 0
  const tipCount = earnings?.tipCount ?? 0
  const earningsHref = `/${username}?tab=earnings`

  return (
    <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] shadow-[var(--card-shadow)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          Earnings
        </span>
        <DollarSign className="h-4 w-4 text-success-foreground" />
      </div>
      <p className="text-2xl font-bold text-foreground">
        ${totalEarned.toFixed(2)}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {tipCount} {networkLabelLowercase()} tip{tipCount === 1 ? '' : 's'}{' '}
        received
      </p>
      <Link
        href={earningsHref}
        className="mt-4 inline-block text-sm font-medium text-brand-blue hover:text-brand-accent"
      >
        View earnings
      </Link>
    </div>
  )
}
