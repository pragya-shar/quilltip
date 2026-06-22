'use client'

import { useState } from 'react'
import { HighlightTipButton } from '@/components/highlights/HighlightTipButton'
import { useHighlightTipResume } from '@/hooks/useHighlightTipResume'
import type { HighlightPendingTipIntent } from '@/lib/tip/pendingTipIntent'
import type { Id } from '@/convex/_generated/dataModel'

interface PendingTipResumeProps {
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  authorStellarAddress?: string | null
}

export function PendingTipResume({
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
}: PendingTipResumeProps) {
  const [intent, setIntent] = useState<HighlightPendingTipIntent | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useHighlightTipResume({
    articleId,
    isOpen,
    onResume: (pending) => {
      setIntent(pending)
      setIsOpen(true)
    },
  })

  if (!intent) return null

  return (
    <div className="sr-only">
      <HighlightTipButton
        articleId={articleId}
        articleSlug={articleSlug}
        authorName={authorName}
        authorStellarAddress={authorStellarAddress}
        highlightText={intent.highlightText}
        startOffset={intent.startOffset}
        endOffset={intent.endOffset}
        startContainerPath={intent.startContainerPath}
        endContainerPath={intent.endContainerPath}
        resumeOpen
        resumeAmountCents={intent.amountCents}
        resumeCustomAmount={intent.customAmount}
        onResumeOpenChange={setIsOpen}
      />
    </div>
  )
}
