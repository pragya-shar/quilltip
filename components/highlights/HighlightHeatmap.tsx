'use client'

import { useArticleHighlightTipStats } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import {
  HEATMAP_GRADIENT_CSS,
  getHeatmapColor,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import { Flame, TrendingUp, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'

interface HighlightHeatmapProps {
  articleId: Id<'articles'>
  isAuthor?: boolean
  className?: string
  embedded?: boolean
}

const heatmapShellClass = (embedded: boolean) =>
  embedded
    ? ''
    : 'bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-[var(--card-padding)]'

type HeatmapWindow = 'all' | '7d' | '30d'

export function HighlightHeatmap({
  articleId,
  isAuthor = false,
  className,
  embedded = false,
}: HighlightHeatmapProps) {
  const [window, setWindow] = useState<HeatmapWindow>('all')

  const sinceMs = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000
    if (window === '7d') return Date.now() - 7 * dayMs
    if (window === '30d') return Date.now() - 30 * dayMs
    return undefined
  }, [window])

  // Fetch highlight tip stats for this article
  const stats = useArticleHighlightTipStats(articleId, { sinceMs })

  // Loading state
  if (stats === undefined) {
    return (
      <div className={cn(heatmapShellClass(embedded), className)}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/2" />
          <div className="h-20 bg-muted rounded"></div>
        </div>
      </div>
    )
  }

  const windowLabel =
    window === '7d' ? '7 days' : window === '30d' ? '30 days' : 'all time'

  // Empty state - No tips yet
  if (!stats || stats.totalTips === 0) {
    return (
      <div className={cn(heatmapShellClass(embedded), className)}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h3
            className={cn(
              'font-semibold flex items-center gap-2',
              embedded ? 'text-sm font-medium' : 'text-lg font-semibold'
            )}
          >
            <Flame className="w-5 h-5 text-muted-foreground" />
            Highlight Heatmap
          </h3>

          <div className="flex items-center rounded-md border border-border overflow-hidden bg-muted/40">
            <button
              type="button"
              onClick={() => setWindow('all')}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                window === 'all'
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              All
            </button>
            <div className="w-px self-stretch bg-border" />
            <button
              type="button"
              onClick={() => setWindow('7d')}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                window === '7d'
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              7d
            </button>
            <div className="w-px self-stretch bg-border" />
            <button
              type="button"
              onClick={() => setWindow('30d')}
              className={cn(
                'px-2.5 py-1 text-xs font-medium transition-colors',
                window === '30d'
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              30d
            </button>
          </div>
        </div>

        <div className="text-center py-8">
          <Sparkles className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm mb-2">
            {window === 'all'
              ? isAuthor
                ? 'No highlight tips yet'
                : 'No highlighted passages supported yet'
              : `No highlight tips in the last ${windowLabel}`}
          </p>
          <p className="text-foreground/85 text-xs">
            {isAuthor
              ? 'Readers can highlight specific phrases and tip them directly'
              : 'Highlight a passage you valued and choose an amount to support it'}
          </p>
        </div>

        {/* Instructions for readers */}
        {!isAuthor && (
          <div className="mt-4 p-4 rounded-lg border border-border bg-muted">
            <p className="text-sm text-foreground">
              <strong>How it works:</strong> Highlight a passage you valued and
              choose an amount to support it.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Calculate max amount for color intensity
  const maxAmount = Math.max(
    ...stats.topHighlights.map((h) => h.totalAmountCents)
  )

  return (
    <div className={cn(heatmapShellClass(embedded), className)}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3
          className={cn(
            'flex items-center gap-2',
            embedded ? 'text-sm font-medium' : 'text-lg font-semibold'
          )}
        >
          <Flame className="w-5 h-5 text-muted-foreground" />
          Highlight Heatmap
        </h3>

        <div className="flex items-center rounded-md border border-border overflow-hidden bg-muted/40">
          <button
            type="button"
            onClick={() => setWindow('all')}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors',
              window === 'all'
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            All
          </button>
          <div className="w-px self-stretch bg-border" />
          <button
            type="button"
            onClick={() => setWindow('7d')}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors',
              window === '7d'
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            7d
          </button>
          <div className="w-px self-stretch bg-border" />
          <button
            type="button"
            onClick={() => setWindow('30d')}
            className={cn(
              'px-2.5 py-1 text-xs font-medium transition-colors',
              window === '30d'
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            30d
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="text-center p-3 rounded-lg border border-border bg-muted/50">
          <div className="text-2xl font-bold text-foreground">
            {stats.totalTips}
          </div>
          <div className="text-xs text-muted-foreground">Total Tips</div>
        </div>
        <div className="text-center p-3 rounded-lg border border-border bg-muted/50">
          <div className="text-2xl font-bold text-foreground">
            ${(stats.totalAmountUsd || 0).toFixed(2)}
          </div>
          <div className="text-xs text-muted-foreground">Total Earned</div>
        </div>
        <div className="text-center p-3 rounded-lg border border-border bg-muted/50">
          <div className="text-2xl font-bold text-foreground">
            {stats.uniqueTippers}
          </div>
          <div className="text-xs text-muted-foreground">Unique Tippers</div>
        </div>
      </div>

      {/* Top Tipped Highlights */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
          <TrendingUp className="w-4 h-4" />
          Top Tipped Phrases
        </div>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {stats.topHighlights.map((highlight, index: number) => {
            const intensity =
              maxAmount > 0 ? highlight.totalAmountCents / maxAmount : 0
            const heatColor = getHeatmapColor(
              highlight.totalAmountCents,
              maxAmount
            )

            return (
              <div
                key={highlight.highlightId}
                className="p-3 rounded-lg border border-border bg-muted/50 transition-colors hover:bg-muted/80"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="h-6 w-6 justify-center p-0 text-xs">
                      {index + 1}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {highlight.tipCount} tip
                      {highlight.tipCount > 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {formatTipAmount(highlight.totalAmountCents)}
                  </span>
                </div>

                <p className="text-sm text-foreground italic line-clamp-2">
                  &ldquo;{highlight.text}&rdquo;
                </p>

                <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${intensity * 100}%`,
                      backgroundColor: heatColor,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Color Legend */}
      <div className="mt-6 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground mb-2 font-medium">
          Heat Intensity:
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Low</span>
          <div
            className="flex-1 h-3 rounded-full"
            style={{ background: HEATMAP_GRADIENT_CSS }}
          />
          <span className="text-xs text-muted-foreground">High</span>
        </div>
      </div>
    </div>
  )
}
