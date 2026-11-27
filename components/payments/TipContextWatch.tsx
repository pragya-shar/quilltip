'use client'

import { useEffect, useRef } from 'react'
import { useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

export type TipContextValue = FunctionReturnType<typeof api.balance.tipContext>

/** Whether one article can take a balance tip, reported to the engine. */
export function TipContextWatch({
  articleId,
  enabled,
  onValue,
}: {
  articleId: Id<'articles'>
  enabled: boolean
  onValue(value: TipContextValue | undefined): void
}) {
  const value = useQuery(
    api.balance.tipContext,
    enabled ? { articleId } : 'skip'
  )
  const report = useRef(onValue)
  report.current = onValue
  useEffect(() => {
    report.current(value)
  }, [value])
  return null
}
