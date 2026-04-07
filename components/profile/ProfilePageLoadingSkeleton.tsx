import { Skeleton } from '@/components/ui/skeleton'
import { ArticleGridSkeleton } from '@/components/articles/ArticleCardSkeleton'

export function ProfilePageLoadingSkeleton() {
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
      <div className="mb-8">
        <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-8">
          <div className="flex flex-col sm:flex-row gap-6">
            <div className="flex-shrink-0">
              <Skeleton className="h-[120px] w-[120px] rounded-full" />
            </div>
            <div className="flex-grow space-y-4">
              <div>
                <Skeleton className="h-9 w-48 max-w-full mb-2" />
                <Skeleton className="h-6 w-32 max-w-full" />
              </div>
              <div className="space-y-2 max-w-2xl">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
              <div className="flex flex-wrap gap-6 pt-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-8" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-9 w-9 rounded-lg" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b border-border mb-8">
        <nav className="-mb-px flex flex-wrap gap-6 sm:space-x-8 sm:gap-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-24 mb-px rounded-none" />
          ))}
        </nav>
      </div>

      <ArticleGridSkeleton count={9} />
    </main>
  )
}
