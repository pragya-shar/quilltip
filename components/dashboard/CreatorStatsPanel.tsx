'use client'

import { BookOpen, DollarSign, Image } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

type CreatorStatsPanelProps = {
  articleCount: number
  tipsReceivedCount: number
  totalEarnedUsd: number
  nftsOwned: number
}

export function CreatorStatsPanel({
  articleCount,
  tipsReceivedCount,
  totalEarnedUsd,
  nftsOwned,
}: CreatorStatsPanelProps) {
  return (
    <Card variant="quiet">
      <CardContent className="pt-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Total Articles</span>
              <BookOpen className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold text-foreground">{articleCount}</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Tips Received</span>
              <DollarSign className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold text-foreground">
              {tipsReceivedCount}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">NFTs Owned</span>
              <Image
                className="w-5 h-5 text-muted-foreground"
                aria-label="NFTs"
              />
            </div>
            <p className="text-3xl font-bold text-foreground">{nftsOwned}</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-muted-foreground">Total tips received</span>
              <DollarSign className="w-5 h-5 text-muted-foreground" />
            </div>
            <p className="text-3xl font-bold text-foreground">
              ${totalEarnedUsd.toFixed(2)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
