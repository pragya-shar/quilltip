'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { buildLoginHref, getCurrentReturnPath } from '@/lib/auth/safeReturnPath'

export function useRedirectWhenUnauthenticated(
  isLoading: boolean,
  isAuthenticated: boolean
): void {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (isLoading || isAuthenticated) return
    const returnPath = getCurrentReturnPath(pathname, searchParams)
    router.replace(buildLoginHref(returnPath))
  }, [isAuthenticated, isLoading, pathname, router, searchParams])
}
