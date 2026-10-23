import { Skeleton } from '@/components/ui/skeleton'
import { ProfileArticlesSkeleton } from './ProfileArticlesSkeleton'

export function ProfilePageLoadingSkeleton() {
  return (
    <main className="profile-folio" aria-hidden>
      <div className="profile-identity">
        <Skeleton className="profile-avatar rounded-full" />
        <div className="profile-introduction space-y-4">
          <Skeleton className="h-14 w-72 max-w-full" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-full max-w-xl" />
          <Skeleton className="h-5 w-2/3 max-w-lg" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="profile-tabs flex gap-8 py-4">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-6 w-20" />
      </div>
      <ProfileArticlesSkeleton />
    </main>
  )
}
