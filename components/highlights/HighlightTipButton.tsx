'use client'

import { lazy, Suspense } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { HighlightTipButtonProps } from './HighlightTipButtonV1'

// Payments v1 until cutover (#451). Both flows load with import().
const HighlightTipButtonV1 = lazy(() =>
  import('./HighlightTipButtonV1').then((mod) => ({
    default: mod.HighlightTipButtonV1,
  }))
)
const HighlightTipV2 = lazy(() =>
  import('@/components/tipping/v2/HighlightTipV2').then((mod) => ({
    default: mod.HighlightTipV2,
  }))
)

/**
 * The passage tip button. Renders the v2 flow when the deployment has
 * payments v2 on (`getChainConfig().v2Enabled`), the v1 flow otherwise.
 */
export function HighlightTipButton(props: HighlightTipButtonProps) {
  const config = useQuery(api.chain.config.getChainConfig, {})
  if (config === undefined) return null
  return (
    <Suspense fallback={null}>
      {config.v2Enabled ? (
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
      ) : (
        <HighlightTipButtonV1 {...props} />
      )}
    </Suspense>
  )
}
