import { Skeleton } from '@/components/ui/skeleton'

export function TipButtonSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
}

export function NftSidebarSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-10 w-full" />
    </div>
  )
}
