import { Skeleton } from '@/components/ui/skeleton'

export function DashboardWalletSkeleton() {
  return (
    <div className="space-y-8">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="max-w-2xl bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-8 space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
        <Skeleton className="h-10 w-36" />
      </div>
    </div>
  )
}
