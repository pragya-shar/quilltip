import { DashboardStatsSkeleton } from '@/components/dashboard/DashboardStatsSkeleton'
import { DashboardWalletSkeleton } from '@/components/dashboard/DashboardWalletSkeleton'
import type { DashboardShellSkeletonProps } from '@/components/dashboard/DashboardShellSkeletonShared'

export function DashboardTabContentSkeleton({
  activeTab,
}: DashboardShellSkeletonProps) {
  if (activeTab === 'wallet') {
    return <DashboardWalletSkeleton />
  }

  if (activeTab === 'stats') {
    return <DashboardStatsSkeleton />
  }

  return <DashboardStatsSkeleton />
}
