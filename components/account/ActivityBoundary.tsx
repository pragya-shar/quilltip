'use client'

import { type ReactNode } from 'react'
import { HistoryBoundary } from '@/components/account/HistoryBoundary'

export function ActivityBoundary({
  children,
  resetKey,
}: {
  children: ReactNode
  resetKey: string
}) {
  return <HistoryBoundary key={resetKey}>{children}</HistoryBoundary>
}
