'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { ProfilePageLoadingSkeleton } from '@/components/profile/ProfilePageLoadingSkeleton'
import {
  WALLET_PROFILE_HUB_PATH,
  getLoginRedirectPath,
  getWalletTabPath,
} from '@/lib/navigation/walletProfileDestination'

export default function ProfileHubPage() {
  const router = useRouter()
  const { user, isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return

    if (isAuthenticated && user?.username) {
      router.replace(getWalletTabPath(user.username))
      return
    }

    if (!isAuthenticated) {
      router.replace(getLoginRedirectPath(WALLET_PROFILE_HUB_PATH))
    }
  }, [isLoading, isAuthenticated, user?.username, router])

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <ProfilePageLoadingSkeleton />
    </div>
  )
}
