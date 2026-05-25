'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import {
  buildLoginRedirectPath,
  buildPathWithSearch,
  resolveSignedInProfilePath,
} from '@/lib/profile/profileDestination'

export function GenericProfileRedirect() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading, user } = useAuth()

  useEffect(() => {
    if (isLoading) return

    const intendedPath = buildPathWithSearch(
      pathname,
      new URLSearchParams(searchParams?.toString() ?? '')
    )

    if (!isAuthenticated) {
      router.replace(buildLoginRedirectPath(intendedPath))
      return
    }

    if (!user?.username) {
      router.replace('/')
      return
    }

    router.replace(
      resolveSignedInProfilePath(
        user.username,
        new URLSearchParams(searchParams?.toString() ?? '')
      )
    )
  }, [
    isAuthenticated,
    isLoading,
    pathname,
    router,
    searchParams,
    user?.username,
  ])

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <ProfilePageLoadingSkeleton />
    </div>
  )
}
