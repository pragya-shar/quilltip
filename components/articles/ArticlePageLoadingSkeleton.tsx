import { Skeleton } from '@/components/ui/skeleton'
import { ArticleBodySkeleton } from './ArticleBodySkeleton'
import { EditorialSurface } from '@/components/layout/EditorialSurface'

export function ArticlePageLoadingSkeleton() {
  return (
    <main className="pt-20" aria-hidden>
      <EditorialSurface className="reader-layout">
        <Skeleton className="h-3 w-32 mb-6" />
        <div className="article-title-bookmark mb-7">
          <Skeleton className="reader-loading-title w-4/5" />
          <Skeleton className="h-11 w-11 shrink-0" />
        </div>
        <div className="flex gap-3 mb-8">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-3 py-1">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
        <Skeleton className="reader-cover" />
        <div className="reader-support">
          <Skeleton className="h-11 w-32" />
          <Skeleton className="h-4 w-44" />
        </div>
        <ArticleBodySkeleton />
        <div className="reader-details py-6">
          <Skeleton className="h-5 w-40" />
        </div>
      </EditorialSurface>
    </main>
  )
}
