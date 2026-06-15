import { cn } from '@/lib/utils'

export const editorToolbarPillClass =
  'flex items-stretch overflow-hidden rounded-full border border-border bg-card shadow-md'

export const editorToolbarIconButtonClass = cn(
  'px-2 py-1.5 transition-colors hover:bg-muted',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
)

export function editorToolbarIconButtonState(active: boolean) {
  return active ? 'bg-muted text-primary' : 'text-foreground'
}

export const editorInsertPlusButtonClass = cn(
  'flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors',
  'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
)
