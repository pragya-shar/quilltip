'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'
import { AccountSurface } from '@/components/account/AccountSurface'
import { DashboardWalletSkeleton } from '@/components/dashboard/DashboardWalletSkeleton'
import { DashboardStatsSkeleton } from '@/components/dashboard/DashboardStatsSkeleton'

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isAuthenticated, isLoading } = useAuth()

  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)

  if (!isAuthenticated && !isLoading) {
    return null
  }

  return (
    <AccountSurface>
      {isLoading ? (
        pathname === '/dashboard/stats' ||
        pathname === '/dashboard/earnings' ? (
          <DashboardStatsSkeleton />
        ) : (
          <DashboardWalletSkeleton />
        )
      ) : (
        children
      )}
    </AccountSurface>
  )
}
