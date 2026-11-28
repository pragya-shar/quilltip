'use client'

import { Suspense } from 'react'
import type { Id } from '@/convex/_generated/dataModel'
import {
  TipCodeBoundary,
  retryableLazy,
} from '@/components/tipping/v2/TipCodeBoundary'

// The flow loads with import(), so the article page's first load holds none
// of it.
const highlightTip = retryableLazy(() =>
  import('@/components/tipping/v2/HighlightTipV2').then((mod) => ({
    default: mod.HighlightTipV2,
  }))
)

export interface HighlightTipButtonProps {
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  highlightText: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
  className?: string
  onSuccess?: () => void
  label?: string
  onBeforeOpen?: () => Promise<boolean>
  disabled?: boolean
  /** The article's title, for the tip basket. */
  articleTitle?: string
  /** "Done" after a result closed the tip dialog. */
  onDone?: () => void
}

/**
 * The passage tip button (payments v2). `HighlightTipGate` shows the paused
 * note in its place while no flow can take a tip.
 */
export function HighlightTipButton(props: HighlightTipButtonProps) {
  return (
    <TipCodeBoundary variant="inline" onRetry={highlightTip.retry}>
      {() => {
        const HighlightTipV2 = highlightTip.Component
        return (
          <Suspense fallback={null}>
            <HighlightTipV2
              articleId={props.articleId}
              articleSlug={props.articleSlug}
              articleTitle={props.articleTitle}
              authorName={props.authorName}
              highlightText={props.highlightText}
              startOffset={props.startOffset}
              endOffset={props.endOffset}
              startContainerPath={props.startContainerPath}
              endContainerPath={props.endContainerPath}
              className={props.className}
              label={props.label}
              onBeforeOpen={props.onBeforeOpen}
              disabled={props.disabled}
              onSuccess={props.onSuccess}
              onDone={props.onDone}
            />
          </Suspense>
        )
      }}
    </TipCodeBoundary>
  )
}
