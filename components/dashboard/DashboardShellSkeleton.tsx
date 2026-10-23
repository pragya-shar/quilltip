import type { DashboardShellSkeletonProps } from '@/components/dashboard/DashboardShellSkeletonShared'
import { DashboardHeaderSkeleton } from '@/components/dashboard/DashboardHeaderSkeleton'
import { DashboardTabBarSkeleton } from '@/components/dashboard/DashboardTabBarSkeleton'
import { DashboardTabContentSkeleton } from '@/components/dashboard/DashboardTabContentSkeleton'

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
