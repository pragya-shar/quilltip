'use client'

import { Skeleton } from '@/components/ui/skeleton'

/** Shown for a moment while the tip form and wallet code load. */
export function TipDialogLoading() {
  return (
    <div className="tip-v2-loading" aria-hidden>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-11 w-2/3" />
    </div>
  )
}
