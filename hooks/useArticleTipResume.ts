'use client'

import { useCallback, useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import type { Id } from '@/convex/_generated/dataModel'
import { hasArticleTipResumeFlag } from '@/lib/tip/articleTipResumeUrl'
import { clearPendingTipIntent } from '@/lib/tip/pendingTipIntent'
import type { ArticlePendingTipIntent } from '@/lib/tip/pendingTipIntent'
import {
  resolveArticleTipResume,
  shouldKeepTryingArticleTipResume,
} from '@/lib/tip/resolveArticleTipResume'

const RESUME_RETRY_MS = 100
const RESUME_TIMEOUT_MS = 15_000

type UseArticleTipResumeOptions = {
  articleId: Id<'articles'>
  isOpen: boolean
  onResume: (intent: ArticlePendingTipIntent) => void
}

/**
 * After login, restores a pending article tip and opens the modal.
 * Retries until auth is ready; defers clearing storage/URL until the modal opens.
 */
export function useArticleTipResume({
  articleId,
  isOpen,
  onResume,
}: UseArticleTipResumeOptions): void {
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const resumedRef = useRef(false)
  const onResumeRef = useRef(onResume)
  onResumeRef.current = onResume

  const stripResumeQueryFromUrl = useCallback(() => {
    if (!hasArticleTipResumeFlag(searchParams)) return
    router.replace(pathname, { scroll: false })
  }, [pathname, router, searchParams])

  const tryResume = useCallback((): boolean => {
    if (resumedRef.current) return true
    if (authLoading || !isAuthenticated) return false

    const intent = resolveArticleTipResume(articleId, searchParams)
    if (!intent) return false

    resumedRef.current = true
    onResumeRef.current(intent)
    return true
  }, [articleId, authLoading, isAuthenticated, searchParams])

  useEffect(() => {
    if (!isOpen || !resumedRef.current) return
    clearPendingTipIntent()
    stripResumeQueryFromUrl()
  }, [isOpen, stripResumeQueryFromUrl])

  useEffect(() => {
    if (tryResume()) return

    if (!shouldKeepTryingArticleTipResume(articleId, searchParams)) return

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
  }, [articleId, searchParams, tryResume])
}
