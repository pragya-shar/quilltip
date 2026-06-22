'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getDashboardTabPath } from '@/lib/dashboard/dashboardTab'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace(getDashboardTabPath('earnings'))
  }, [router])

  return null
}
