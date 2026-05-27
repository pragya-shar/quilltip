'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import AppNavigation from '@/components/layout/AppNavigation'
import { Skeleton } from '@/components/ui/skeleton'

const WALLET_RETURN_PATH = '/profile?tab=wallet'

export default function ProfilePage() {
  const router = useRouter()
  const { user, isAuthenticated, isLoading } = useAuth()

  useEffect(() => {
    if (isLoading) return
    if (isAuthenticated && user?.username) {
      router.replace(`/${user.username}?tab=wallet`)
      return
    }
    if (!isAuthenticated) {
      router.replace(buildLoginHref(WALLET_RETURN_PATH))
    }
  }, [isAuthenticated, isLoading, router, user?.username])

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
        <Skeleton className="h-9 w-48 mb-8" />
        <Skeleton className="h-64 w-full max-w-2xl" />
      </div>
    </div>
  )
}
