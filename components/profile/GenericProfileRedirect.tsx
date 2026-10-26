'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import { resolveProfileAliasPath } from '@/lib/profile/profileDestination'
import '@/components/articles/reading-room.css'
import '@/components/profile/public-profile.css'

export function GenericProfileRedirect() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading, user } = useAuth()

  useEffect(() => {
    if (isLoading) return

    const params = new URLSearchParams(searchParams?.toString() ?? '')

    if (!isAuthenticated) {
      router.replace(buildLoginHref(resolveProfileAliasPath(pathname, params)))
      return
    }

    if (!user?.username) {
      router.replace('/')
      return
    }

    router.replace(resolveProfileAliasPath(pathname, params, user.username))
  }, [
    isAuthenticated,
    isLoading,
    pathname,
    router,
    searchParams,
    user?.username,
  ])

  return (
    <div className="profile-page min-h-screen">
      <AppNavigation />
      <ProfilePageLoadingSkeleton />
    </div>
  )
}
