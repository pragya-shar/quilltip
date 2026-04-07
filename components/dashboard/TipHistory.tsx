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
    <div className="bg-white rounded-lg shadow">
      <div className="p-6 border-b">
        <h3 className="text-lg font-semibold">Recent Tips</h3>
      </div>
      <div className="divide-y">
        {tips.slice(0, 10).map((tip) => (
          <div key={tip._id} className="p-4 hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">
                  {tip.tipper?.name || tip.tipper?.username || 'Anonymous'}
                </p>
                <p className="text-sm text-gray-500">
                  tipped on &ldquo;{tip.articleTitle}&rdquo;
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-green-800 dark:text-green-300">
                  +${tip.amountUsd.toFixed(2)}
                </p>
                <p className="text-xs text-gray-500">
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
