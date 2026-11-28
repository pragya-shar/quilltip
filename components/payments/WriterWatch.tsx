'use client'

import { useEffect, useMemo } from 'react'
import { useConvexAuth, usePaginatedQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { paymentsStore } from '@/lib/payments/store'
import type { ActivityView } from '@/lib/payments/types'
import {
  activityItemOf,
  pageState,
  type ActivityEntry,
} from '@/lib/payments/views'

export const WRITER_PAGE = 20

/** The writer's list of tips, while a screen shows it; written only while
 * the engine's binding holds (`live`), and again when it holds again. */
export function WriterWatch({ now, live }: { now: number; live: boolean }) {
  const { isAuthenticated } = useConvexAuth()
  const writer = usePaginatedQuery(
    api.activity.mine,
    isAuthenticated ? { role: 'writer' } : 'skip',
    { initialNumItems: WRITER_PAGE }
  )
  const view = useMemo<ActivityView>(
    () => ({
      status: pageState(writer.status).firstLoad ? 'loading' : 'ready',
      items: (writer.results as ActivityEntry[]).map((e) =>
        activityItemOf(e, now)
      ),
      canLoadMore: pageState(writer.status).canLoadMore,
      loadingMore: pageState(writer.status).loadingMore,
      loadMore: () => writer.loadMore(WRITER_PAGE),
    }),
    [writer, now]
  )
  useEffect(() => {
    if (live) paymentsStore.set({ writerActivity: view })
  }, [view, live])
  return null
}
