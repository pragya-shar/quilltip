/**
 * Loading UI convention (Quilltip):
 * - Page and section async data: composed placeholders built from `Skeleton` and
 *   named `*Skeleton` components (e.g. ArticleGridSkeleton). Use `animate-pulse`
 *   via this primitive only.
 * - Buttons and inline async actions: `Loader2` from lucide-react with
 *   `animate-spin`, not full-page spinners for main content.
 */
import { cn } from '@/lib/utils'

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-primary/10', className)}
      {...props}
    />
  )
}

export { Skeleton }
