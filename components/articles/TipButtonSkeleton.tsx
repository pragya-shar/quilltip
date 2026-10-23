import { Skeleton } from '@/components/ui/skeleton'

export function TipButtonSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
}
