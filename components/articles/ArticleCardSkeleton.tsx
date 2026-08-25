import { Skeleton } from '@/components/ui/skeleton'

export function ArticleCardSkeleton() {
  return (
    <div
      className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border overflow-hidden"
      aria-hidden
    >
      {/* Cover image placeholder */}
      <Skeleton className="h-48 w-full rounded-none" />

      <div className="p-[var(--card-padding)]">
        {/* Title */}
        <Skeleton className="h-6 w-3/4 mb-2" />
        <Skeleton className="h-6 w-1/2 mb-4" />

        {/* Excerpt */}
        <Skeleton className="h-4 w-full mb-2" />
        <Skeleton className="h-4 w-5/6 mb-4" />

        {/* Tags */}
        <div className="flex gap-2 mb-4">
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>

        {/* Author + meta */}
        <div className="flex items-end justify-between gap-3 pt-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full" />
            <div>
              <Skeleton className="h-4 w-24 mb-1" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    </div>
  )
}

export function ArticleGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }).map((_, i) => (
        <ArticleCardSkeleton key={i} />
      ))}
    </div>
  )
}
