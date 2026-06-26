'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DashboardTabBar } from '@/components/dashboard/DashboardTabBar'
import { DashboardShellSkeleton } from '@/components/dashboard/DashboardShellSkeleton'
import {
  DASHBOARD_TAB_IDS,
  type DashboardTabId,
} from '@/lib/dashboard/dashboardTab'
import { ChartBar, DollarSign, Wallet } from 'lucide-react'

const DASHBOARD_TABS = [
  { id: 'wallet' as const, label: 'Wallet', icon: Wallet },
  { id: 'earnings' as const, label: 'Earnings', icon: DollarSign },
  { id: 'stats' as const, label: 'Stats', icon: ChartBar },
]

function activeTabFromPathname(pathname: string): DashboardTabId {
  const segment = pathname.split('/').pop()
  if (segment && DASHBOARD_TAB_IDS.includes(segment as DashboardTabId)) {
    return segment as DashboardTabId
  }
  return 'earnings'
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isAuthenticated, isLoading } = useAuth()

  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)

  const activeTab = activeTabFromPathname(pathname)

  if (!isAuthenticated && !isLoading) {
    return null
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <AppNavigation />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 w-full min-w-0">
          <DashboardShellSkeleton activeTab={activeTab} />
        </main>
        <SiteFooter variant="default" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppNavigation />

      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12 w-full min-w-0">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Creator Dashboard
          </h1>
          <p className="text-muted-foreground">
            Manage your wallet, earnings, and creator stats.
          </p>
        </div>

        <DashboardTabBar tabs={DASHBOARD_TABS} activeTab={activeTab} />

        {children}
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}
