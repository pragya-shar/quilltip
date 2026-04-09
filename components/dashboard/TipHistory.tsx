'use client'

import type { Doc } from '@/types/convex'

export type ReceivedTipRow = Doc<'tips'> & {
  tipper: { name?: string; username?: string } | null
  articleTitle: string
}

type TipHistoryProps = {
  tips: ReceivedTipRow[] | undefined
}

export function TipHistory({ tips }: TipHistoryProps) {
  if (!tips || tips.length === 0) {
    return null
  }

  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-semibold">Recent Tips</h3>
      </div>
      <div className="divide-y divide-border">
        {tips.slice(0, 10).map((tip) => (
          <div key={tip._id} className="p-4 hover:bg-muted/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-foreground">
                  {tip.tipper?.name || tip.tipper?.username || 'Anonymous'}
                </p>
                <p className="text-sm text-muted-foreground">
                  tipped on &ldquo;{tip.articleTitle}&rdquo;
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-success-foreground">
                  +${tip.amountUsd.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(tip.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
