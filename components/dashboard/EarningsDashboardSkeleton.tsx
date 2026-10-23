import { StatCardsSkeleton } from '@/components/dashboard/StatCardsSkeleton'
import { MonthlyChartSkeleton } from '@/components/dashboard/MonthlyChartSkeleton'
import { TopArticlesListSkeleton } from '@/components/dashboard/TopArticlesListSkeleton'
import { RecentTipsSkeleton } from '@/components/dashboard/RecentTipsSkeleton'

export function EarningsDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <StatCardsSkeleton />
      <MonthlyChartSkeleton />
      <TopArticlesListSkeleton />
      <RecentTipsSkeleton />
    </div>
  )
}
