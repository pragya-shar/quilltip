'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  DEFAULT_DASHBOARD_TAB,
  getDashboardTabPath,
} from '@/lib/dashboard/dashboardTab'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace(getDashboardTabPath(DEFAULT_DASHBOARD_TAB))
  }, [router])

  return null
}
