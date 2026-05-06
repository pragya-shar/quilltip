'use client'

import { useArticleTipStats } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { Skeleton } from '@/components/ui/skeleton'
import { Coins, Users } from 'lucide-react'

interface TipStatsProps {
  articleId: Id<'articles'>
  className?: string
}

export function TipStats({ articleId, className = '' }: TipStatsProps) {
  const stats = useArticleTipStats(articleId)

  if (stats === undefined) {
    return (
      <div
        className={`flex items-center gap-4 text-sm text-muted-foreground ${className}`}
        aria-hidden
      >
        <div className="flex items-center gap-1">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-12" />
        </div>
        <div className="flex items-center gap-1">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-6" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-4 text-sm text-muted-foreground ${className}`}
    >
      <div className="flex items-center gap-1">
        <Coins className="w-4 h-4 text-yellow-500" />
        <span className="font-medium">
          ${(stats?.totalAmountUsd ?? 0).toFixed(2)}
        </span>
        <span>earned</span>
      </div>
      <div className="flex items-center gap-1">
        <Users className="w-4 h-4 text-blue-500" />
        <span className="font-medium">{stats?.uniqueTippers ?? 0}</span>
        <span>
          {(stats?.uniqueTippers ?? 0) === 1 ? 'supporter' : 'supporters'}
        </span>
      </div>
    </div>
  )
}
