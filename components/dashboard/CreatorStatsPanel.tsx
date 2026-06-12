'use client'

import { BookOpen, DollarSign, Image } from 'lucide-react'

type CreatorStatsPanelProps = {
  articleCount: number
  tipsReceivedCount: number
  nftsOwned: number
}

export function CreatorStatsPanel({
  articleCount,
  tipsReceivedCount,
  nftsOwned,
}: CreatorStatsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Total Articles</span>
            <BookOpen className="w-5 h-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-foreground">{articleCount}</p>
        </div>
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">Tips Received</span>
            <DollarSign className="w-5 h-5 text-green-500" />
          </div>
          <p className="text-3xl font-bold text-foreground">
            {tipsReceivedCount}
          </p>
        </div>
        <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground">NFTs Owned</span>
            <Image className="w-5 h-5 text-purple-500" aria-label="NFTs" />
          </div>
          <p className="text-3xl font-bold text-foreground">{nftsOwned}</p>
        </div>
      </div>
    </div>
  )
}
