import { Skeleton } from '@/components/ui/skeleton'

export function ArticleBodySkeleton() {
  return (
    <div className="space-y-4 py-2" aria-hidden>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  )
}
