import { Skeleton } from '@/components/ui/skeleton'
import { EarningsDashboardSkeleton } from '@/components/dashboard/EarningsDashboardSkeleton'
import { DashboardStatsSkeleton } from '@/components/dashboard/DashboardStatsSkeleton'
import { DashboardWalletSkeleton } from '@/components/dashboard/DashboardWalletSkeleton'
import type { DashboardTabId } from '@/lib/dashboard/dashboardTab'

function DashboardHeaderSkeleton() {
  return (
    <div className="mb-8 space-y-2">
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-5 w-96 max-w-full" />
    </div>
  )
}

function DashboardTabBarSkeleton() {
  return (
    <div className="min-w-0 w-full overflow-hidden border-b border-border mb-8">
      <div className="-mb-px flex flex-nowrap gap-4 sm:gap-8 pb-0.5">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-24 shrink-0" />
        ))}
      </div>
    </div>
  )
}

type DashboardShellSkeletonProps = {
  activeTab: DashboardTabId
}

function DashboardTabContentSkeleton({
  activeTab,
}: DashboardShellSkeletonProps) {
  if (activeTab === 'wallet') {
    return <DashboardWalletSkeleton />
  }

  if (activeTab === 'stats') {
    return <DashboardStatsSkeleton />
  }

  return <EarningsDashboardSkeleton />
}

export function DashboardShellSkeleton({
  activeTab,
}: DashboardShellSkeletonProps) {
  return (
    <>
      <DashboardHeaderSkeleton />
      <DashboardTabBarSkeleton />
      <DashboardTabContentSkeleton activeTab={activeTab} />
    </>
  )
}
