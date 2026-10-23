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

interface HighlightHeatmapProps {
  articleId: Id<'articles'>
  isAuthor?: boolean
  className?: string
  embedded?: boolean
}

const heatmapShellClass = (embedded: boolean) =>
  embedded
    ? 'highlight-heatmap'
    : 'highlight-heatmap border border-ui-border bg-ui-surface rounded-[var(--ui-radius)] p-5'

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

  const windowLabel =
    window === '7d' ? '7 days' : window === '30d' ? '30 days' : 'all time'
  const maxAmount = Math.max(
    0,
    ...(stats?.topHighlights.map((h) => h.totalAmountCents) ?? [])
  )

  return (
    <section
      className={cn(heatmapShellClass(embedded), className)}
      aria-label="Highlight heatmap"
    >
      <div className="highlight-heatmap-header">
        <h3>
          <Flame className="h-4 w-4 text-ui-primary" aria-hidden />
          Highlight heatmap
        </h3>
        <div
          className="highlight-heatmap-window"
          role="group"
          aria-label="Heatmap time range"
        >
          {(
            [
              ['all', 'All', 'All time'],
              ['7d', '7d', 'Last 7 days'],
              ['30d', '30d', 'Last 30 days'],
            ] as const
          ).map(([value, label, accessibleLabel]) => (
            <button
              key={value}
              type="button"
              aria-label={accessibleLabel}
              aria-pressed={window === value}
              onClick={() => setWindow(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {stats === undefined ? (
        <div role="status" className="highlight-empty">
          <span>Loading passage support…</span>
          <div
            className="mt-4 h-16 rounded-[var(--ui-radius)] bg-ui-muted motion-safe:animate-pulse"
            aria-hidden
          />
        </div>
      ) : !stats || stats.totalTips === 0 ? (
        <div className="highlight-empty">
          <Sparkles aria-hidden />
          <p className="font-semibold text-ui-foreground mb-1">
            {window === 'all'
              ? isAuthor
                ? 'No highlight tips yet'
                : 'No highlighted passages supported yet'
              : `No highlight tips in the last ${windowLabel}`}
          </p>
          <p>
            {isAuthor
              ? 'Readers can highlight specific phrases and tip them directly.'
              : 'Highlight a passage you valued and choose an amount to support it.'}
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-ui-muted-foreground">
            Passage support · {windowLabel}
          </p>
          <div className="highlight-heatmap-summary">
            <div>
              <strong>{stats.totalTips}</strong>
              <span>Total tips</span>
            </div>
            <div>
              <strong>${(stats.totalAmountUsd || 0).toFixed(2)}</strong>
              <span>Total tipped</span>
            </div>
            <div>
              <strong>{stats.uniqueTippers}</strong>
              <span>Supporters</span>
            </div>
          </div>
          <h4 className="flex items-center gap-2 text-sm font-semibold mb-1">
            <TrendingUp className="h-4 w-4 text-ui-primary" aria-hidden />
            Top tipped passages
          </h4>
          <div
            className="max-h-[400px] overflow-y-auto"
            role="list"
            aria-label="Top tipped passages"
          >
            {stats.topHighlights.map((highlight, index) => {
              const intensity =
                maxAmount > 0 ? highlight.totalAmountCents / maxAmount : 0
              return (
                <div
                  key={highlight.highlightId}
                  className="highlight-heatmap-passage"
                  role="listitem"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-ui-muted-foreground">
                      <span className="highlight-heatmap-rank">
                        {index + 1}
                      </span>
                      {highlight.tipCount} tip
                      {highlight.tipCount !== 1 ? 's' : ''}
                    </span>
                    <span className="font-semibold text-ui-primary">
                      {formatTipAmount(highlight.totalAmountCents)}
                    </span>
                  </div>
                  <blockquote>&ldquo;{highlight.text}&rdquo;</blockquote>
                  <div
                    className="highlight-heatmap-track"
                    role="img"
                    aria-label={`${Math.round(intensity * 100)}% of the most supported passage's tip amount`}
                  >
                    <div
                      className="h-full"
                      style={{
                        width: `${intensity * 100}%`,
                        backgroundColor: getHeatmapColor(
                          highlight.totalAmountCents,
                          maxAmount
                        ),
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="highlight-heatmap-legend">
            <p className="mb-2">Relative tip amount</p>
            <div className="flex items-center gap-3">
              <span>Less</span>
              <div
                className="flex-1 h-3 border border-ui-input rounded-sm"
                style={{ background: HEATMAP_GRADIENT_CSS }}
                aria-hidden
              />
              <span>More</span>
            </div>
            <p className="mt-2">
              Bar length and shade show support relative to the top passage.
            </p>
          </div>
        </>
      )}
    </section>
  )
}
