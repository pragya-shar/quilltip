'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function useRedirectWhenUnauthenticated(
  isLoading: boolean,
  isAuthenticated: boolean,
  loginPath = '/login'
): void {
  const router = useRouter()
  useEffect(() => {
    if (isLoading) return
    if (!isAuthenticated) {
      router.push(loginPath)
    }
  }, [isAuthenticated, isLoading, loginPath, router])
}
