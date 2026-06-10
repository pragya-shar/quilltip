'use client'

import { useRouter } from 'next/navigation'
import {
  getDashboardTabPath,
  type DashboardTabId,
} from '@/lib/dashboard/dashboardTab'

export function useDashboardNavigation() {
  const router = useRouter()

  return (tab: DashboardTabId) => {
    router.push(getDashboardTabPath(tab))
  }
}
