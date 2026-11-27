'use client'

import { useEffect, useMemo } from 'react'
import { useConvexAuth, usePaginatedQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { paymentsStore } from '@/lib/payments/store'
import type { ActivityView } from '@/lib/payments/types'
import { activityItemOf, type ActivityEntry } from '@/lib/payments/views'

export const WRITER_PAGE = 20

/** The writer's list of tips, while a screen shows it. */
export function WriterWatch({ now }: { now: number }) {
  const { isAuthenticated } = useConvexAuth()
  const writer = usePaginatedQuery(
    api.activity.mine,
    isAuthenticated ? { role: 'writer' } : 'skip',
    { initialNumItems: WRITER_PAGE }
  )
  const view = useMemo<ActivityView>(
    () => ({
      status: writer.status === 'LoadingFirstPage' ? 'loading' : 'ready',
      items: (writer.results as ActivityEntry[]).map((e) =>
        activityItemOf(e, now)
      ),
      canLoadMore: writer.status === 'CanLoadMore',
      loadMore: () => writer.loadMore(WRITER_PAGE),
    }),
    [writer, now]
  )
  useEffect(() => {
    paymentsStore.set({ writerActivity: view })
  }, [view])
  return null
}
