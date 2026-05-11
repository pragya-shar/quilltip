'use client'

import Link from 'next/link'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import AppNavigation from '@/components/layout/AppNavigation'
import {
  AdminStatsDashboard,
  type AdminStatsSnapshot,
} from '@/components/admin/AdminStatsDashboard'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { useAuth } from '@/components/providers/AuthContext'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

function AdminStatsSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-5 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36 rounded-[var(--card-radius)]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-40 rounded-[var(--card-radius)]" />
        <Skeleton className="h-40 rounded-[var(--card-radius)]" />
      </div>
      <Skeleton className="h-80 rounded-[var(--card-radius)]" />
    </div>
  )
}

function AdminStatsQuery() {
  const stats = useQuery(api.admin.getStats, { recentLimit: 20 })

  if (stats === undefined) {
    return <AdminStatsSkeleton />
  }

  return <AdminStatsDashboard stats={stats as AdminStatsSnapshot} />
}

function AdminStatsFallback({ reset }: { reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Admin access required</AlertTitle>
      <AlertDescription className="space-y-4">
        <p>
          This dashboard is restricted to emails listed in `ADMIN_EMAILS`. If
          you expected access, update the environment variable and try again.
        </p>
        <Button type="button" variant="outline" onClick={reset}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export default function AdminStatsPage() {
  const { isAuthenticated, isLoading } = useAuth()

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <main className="mx-auto max-w-7xl px-4 pb-12 pt-24 sm:px-6 lg:px-8">
        {isLoading ? (
          <AdminStatsSkeleton />
        ) : !isAuthenticated ? (
          <Alert>
            <AlertTitle>Sign in required</AlertTitle>
            <AlertDescription className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Sign in with an allowlisted admin account to view beta evidence
                metrics.
              </span>
              <Button asChild>
                <Link href="/login">Sign In</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <ErrorBoundary
            fallback={({ reset }) => <AdminStatsFallback reset={reset} />}
          >
            <AdminStatsQuery />
          </ErrorBoundary>
        )}
      </main>
    </div>
  )
}
