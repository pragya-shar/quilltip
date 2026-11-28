'use client'

import { useEffect, useMemo } from 'react'
import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { paymentsStore } from '@/lib/payments/store'
import { earningsViewOf, type ActivityEntry } from '@/lib/payments/views'
import { useAsOf } from './useAsOf'
import { WRITER_PAGE } from './WriterWatch'

/** The writer's earnings, while a screen shows them. */
export function EarningsWatch({
  now,
  online,
  live,
}: {
  now: number
  online: boolean
  /** The engine's binding holds: written only then, and again when it
   * holds again. */
  live: boolean
}) {
  const { isAuthenticated, isLoading } = useConvexAuth()
  const earnings = useQuery(api.earnings.mine, isAuthenticated ? {} : 'skip')
  const newest = usePaginatedQuery(
    api.activity.mine,
    isAuthenticated ? { role: 'writer' } : 'skip',
    { initialNumItems: WRITER_PAGE }
  )
  const asOf = useAsOf(online && earnings !== undefined, now)
  const view = useMemo(
    () =>
      earningsViewOf({
        signedIn: isLoading || isAuthenticated,
        earnings: isLoading ? undefined : earnings,
        entries: newest.results as ActivityEntry[],
        now,
        asOf,
      }),
    [isLoading, isAuthenticated, earnings, newest.results, now, asOf]
  )
  useEffect(() => {
    if (live) paymentsStore.set({ earnings: view })
  }, [view, live])
  return null
}
