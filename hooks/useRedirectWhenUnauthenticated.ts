'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSignOutFrom } from '@/components/providers/AuthContext'
import { buildLoginHref, getCurrentReturnPath } from '@/lib/auth/safeReturnPath'

export function useRedirectWhenUnauthenticated(
  isLoading: boolean,
  isAuthenticated: boolean
): void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const signOutFrom = useSignOutFrom()

  useEffect(() => {
    if (isLoading || isAuthenticated) return
    // The reader signed out here: /login with no path to return to, or the
    // next reader to sign in would be sent to this page (#608).
    if (signOutFrom === pathname) {
      router.replace('/login')
      return
    }
    const returnPath = getCurrentReturnPath(pathname, searchParams)
    router.replace(buildLoginHref(returnPath))
  }, [isAuthenticated, isLoading, pathname, router, searchParams, signOutFrom])
}
