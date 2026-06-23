'use client'

import type { ReactNode } from 'react'
import AppNavigation from '@/components/layout/AppNavigation'
import { useRedirectWhenUnauthenticated } from '@/hooks/useRedirectWhenUnauthenticated'

type ProtectedPageShellProps = {
  isLoading: boolean
  isAuthenticated: boolean
  loadingContent: ReactNode
  children: ReactNode
  shellClassName?: string
}

export function ProtectedPageShell({
  isLoading,
  isAuthenticated,
  loadingContent,
  children,
  shellClassName = 'min-h-screen bg-background',
}: ProtectedPageShellProps) {
  useRedirectWhenUnauthenticated(isLoading, isAuthenticated)

  if (isLoading) {
    return (
      <div className={shellClassName}>
        <AppNavigation />
        {loadingContent}
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  return <>{children}</>
}
