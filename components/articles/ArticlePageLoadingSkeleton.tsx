import { Skeleton } from '@/components/ui/skeleton'

export function ArticlePageLoadingSkeleton() {
  return (
    <main className="pt-20">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Skeleton className="h-96 w-full rounded-lg mb-8" />
        <Skeleton className="h-8 w-3/4 mb-4" />
        <Skeleton className="h-4 w-1/2 mb-8" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    </main>
  )
}
