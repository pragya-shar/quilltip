'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import type { Id } from '@/convex/_generated/dataModel'
import {
  clearPendingTipIntent,
  matchesHighlightPendingIntent,
  readPendingTipIntent,
  type HighlightPendingTipIntent,
} from '@/lib/tip/pendingTipIntent'

const RESUME_RETRY_MS = 100
const RESUME_TIMEOUT_MS = 15_000

type UseHighlightTipResumeOptions = {
  articleId: Id<'articles'>
  isOpen: boolean
  onResume: (intent: HighlightPendingTipIntent) => void
}

/**
 * After login, restores a pending highlight tip and opens the modal.
 * Retries until auth is ready; defers clearing storage until the modal opens.
 */
export function useHighlightTipResume({
  articleId,
  isOpen,
  onResume,
}: UseHighlightTipResumeOptions): void {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const resumedRef = useRef(false)
  const claimedRef = useRef(false)
  const onResumeRef = useRef(onResume)
  onResumeRef.current = onResume

  const tryResume = useCallback((): boolean => {
    if (resumedRef.current) return true
    if (authLoading || !isAuthenticated) return false

    const intent = readPendingTipIntent()
    if (!matchesHighlightPendingIntent(intent, articleId)) return false

    if (claimedRef.current) return false
    claimedRef.current = true
    resumedRef.current = true
    onResumeRef.current(intent)
    return true
  }, [articleId, authLoading, isAuthenticated])

  useEffect(() => {
    if (!isOpen || !resumedRef.current) return
    clearPendingTipIntent()
  }, [isOpen])

  useEffect(() => {
    if (tryResume()) return

    const pending = readPendingTipIntent()
    if (!matchesHighlightPendingIntent(pending, articleId)) return

    const intervalId = window.setInterval(() => {
      if (tryResume()) {
        window.clearInterval(intervalId)
      }
    }, RESUME_RETRY_MS)

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId)
    }, RESUME_TIMEOUT_MS)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [articleId, tryResume])
}
