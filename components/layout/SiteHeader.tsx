'use client'

import { useAuth } from '@/components/providers/AuthContext'
import Navigation from '@/components/landing/Navigation'
import AppNavigation from '@/components/layout/AppNavigation'

export function SiteHeader() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <AppNavigation />
  }

  if (isAuthenticated) {
    return <AppNavigation />
  }

  return <Navigation />
}
