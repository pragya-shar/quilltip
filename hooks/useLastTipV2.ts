'use client'

/**
 * The v2 tip a surface started in this browser, if any, and its server
 * status. Used by the tip triggers to say "Your last tip is being checked"
 * after a reload. Light: Convex and localStorage only, no payment code.
 */
import { useCallback, useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useAuth } from '@/components/providers/AuthContext'
import { pendingKey, readPending, type PendingTip } from '@/lib/tip/v2/pending'

export function useLastTipV2(scope: string) {
  const { user } = useAuth()
  const key = user?._id ? pendingKey(user._id, scope) : null
  const [pending, setPending] = useState<PendingTip | null>(null)
  const refresh = useCallback(() => {
    setPending(key ? readPending(key) : null)
  }, [key])
  useEffect(() => {
    refresh()
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [key, refresh])
  const status = useQuery(
    api.tipsV2.getTipStatus,
    pending
      ? { submissionId: pending.submissionId as Id<'chainSubmissions'> }
      : 'skip'
  )
  return { pending: status === null ? null : pending, status, refresh }
}
