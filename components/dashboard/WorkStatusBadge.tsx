'use client'

import { cn } from '@/lib/utils'

export function WorkStatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
        published
          ? 'bg-success/10 text-success-foreground'
          : 'bg-warning/10 text-warning-foreground'
      )}
    >
      {published ? 'Published' : 'Draft'}
    </span>
  )
}
