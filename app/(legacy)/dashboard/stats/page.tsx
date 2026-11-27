import type { Metadata } from 'next'
import { DashboardStatsContent } from '@/components/dashboard/DashboardStatsContent'

export const metadata: Metadata = {
  title: 'Stats',
}

export default function DashboardStatsPage() {
  return <DashboardStatsContent />
}
