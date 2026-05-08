'use client'

import { useAuth } from '@/components/providers/AuthContext'
import Navigation from '@/components/landing/Navigation'
import AppNavigation from '@/components/layout/AppNavigation'
import { WalletGuide } from '@/components/guide/WalletGuide'

export default function GuidePage() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="min-h-screen bg-background">
      {isAuthenticated ? <AppNavigation /> : <Navigation />}
      <div className="pt-24 pb-16 px-4">
        <WalletGuide />
      </div>
    </div>
  )
}
