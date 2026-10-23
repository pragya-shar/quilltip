'use client'

import { testnetBadgeLabel } from '@/lib/copy/network-status'
import { cn } from '@/lib/utils'

export function NetworkBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground',
        className
      )}
    >
      {testnetBadgeLabel()}
    </span>
  )
}
