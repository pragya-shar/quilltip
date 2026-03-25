'use client'

import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { Coins, Users } from 'lucide-react'

interface TipStatsProps {
  articleId: Id<'articles'>
  className?: string
}

export function TipStats({ articleId, className = '' }: TipStatsProps) {
  const stats = useQuery(api.tips.getArticleTipStats, { articleId })

  // Don't show anything while loading
  if (stats === undefined) {
    return null
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
