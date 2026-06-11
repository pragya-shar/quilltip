import { Skeleton } from '@/components/ui/skeleton'

export function ArticleFeedRowSkeleton() {
  return (
    <div className="py-8 first:pt-6 last:pb-6" aria-hidden>
      <div className="mb-3 flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="h-3.5 w-12" />
      </div>

      <div className="flex items-start gap-4 sm:gap-6">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-full sm:h-8" />
          <Skeleton className="h-7 w-4/5 sm:h-8" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-[72px] w-[72px] shrink-0 rounded-sm sm:h-[112px] sm:w-[112px]" />
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <div className="flex items-center gap-0.5">
          <Skeleton className="h-9 w-9 rounded-full" />
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
      </div>
    </div>
  )
}

export function ArticleFeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="max-w-3xl mx-auto divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <ArticleFeedRowSkeleton key={i} />
      ))}
    </div>
  )
}
