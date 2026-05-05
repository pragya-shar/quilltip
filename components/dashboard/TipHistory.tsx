'use client'

import { formatDistanceToNow } from 'date-fns'
import type { Doc } from '@/types/convex'

export type ReceivedTipRow = Doc<'tips'> & {
  tipper: { name?: string; username?: string } | null
  articleTitle: string
}

type TipHistoryProps = {
  tips: ReceivedTipRow[] | undefined
}

export function TipHistory({ tips }: TipHistoryProps) {
  const list = tips?.length ? tips : null

  return (
    <div className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border">
      <div className="p-6 border-b border-border">
        <h3 className="text-lg font-semibold">Recent Tips</h3>
      </div>
      {list ? (
        <div className="divide-y divide-border">
          {list.slice(0, 10).map((tip) => {
            const tipDate = new Date(tip.createdAt)
            const relative = formatDistanceToNow(tipDate, { addSuffix: true })
            const absolute = tipDate.toLocaleDateString('en-US', {
              dateStyle: 'long',
            })
            const a11yLabel = `${relative}. ${absolute}.`

            return (
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
                    <time
                      dateTime={tipDate.toISOString()}
                      title={absolute}
                      aria-label={a11yLabel}
                      className="text-xs text-muted-foreground"
                    >
                      {relative}
                    </time>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <p className="font-medium text-foreground">No tips yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            When readers tip your work, they will show up here.
          </p>
        </div>
      )}
    </div>
  )
}
