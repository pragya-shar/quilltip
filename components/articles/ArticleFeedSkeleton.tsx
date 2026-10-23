import { ArticleFeedRowSkeleton } from '@/components/articles/ArticleFeedRowSkeleton'

export function ArticleFeedSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="max-w-3xl mx-auto divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <ArticleFeedRowSkeleton key={i} />
      ))}
    </div>
  )
}

export { ArticleFeedRowSkeleton } from '@/components/articles/ArticleFeedRowSkeleton'
