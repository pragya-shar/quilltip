'use client'

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import { HighlightTipButton } from '@/components/highlights/HighlightTipButton'
import {
  clearPendingTipIntent,
  matchesHighlightPendingIntent,
  readPendingTipIntent,
  type HighlightPendingTipIntent,
} from '@/lib/tip/pendingTipIntent'
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
  const { isAuthenticated } = useAuth()
  const resumedRef = useRef(false)
  const [intent, setIntent] = useState<HighlightPendingTipIntent | null>(null)

  useEffect(() => {
    if (!isAuthenticated || resumedRef.current) return
    const pending = readPendingTipIntent()
    if (!matchesHighlightPendingIntent(pending, articleId)) return
    resumedRef.current = true
    clearPendingTipIntent()
    setIntent(pending)
  }, [isAuthenticated, articleId])

  if (!intent) return null

  return (
    <div className="sr-only" aria-hidden>
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
      />
    </div>
  )
}
