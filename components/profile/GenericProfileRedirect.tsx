'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { AccountSurface } from '@/components/account/AccountSurface'
import { ProfileSettingsSkeleton } from '@/components/settings/ProfileSettingsSkeleton'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import { resolveProfileAliasPath } from '@/lib/profile/profileDestination'
import { SETTINGS_PATH } from '@/lib/navigation/siteNavigation'
import '@/components/account/account.css'
import '@/components/settings/profile-settings.css'

/**
 * `/profile` and `/settings/profile` open profile settings. Older links with a
 * `?tab=` keep going to that view of the writer page or dashboard.
 */
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

    if (!params.has('tab') || !user?.username) {
      router.replace(SETTINGS_PATH)
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
    <AccountSurface>
      <p className="sr-only" role="status">
        Opening your profile settings.
      </p>
      <ProfileSettingsSkeleton />
    </AccountSurface>
  )
}
