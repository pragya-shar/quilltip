'use client'

import { useAuth } from '@/components/providers/AuthContext'
import Navigation from '@/components/landing/Navigation'
import AppNavigation from '@/components/layout/AppNavigation'
import { WalletGuide } from '@/components/guide/WalletGuide'
import { SiteFooter } from '@/components/layout/SiteFooter'

export default function GuidePage() {
  const { isAuthenticated } = useAuth()

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {isAuthenticated ? <AppNavigation /> : <Navigation />}
      <div className="flex-1 pt-24 pb-16 px-4">
        <WalletGuide />
      </div>
      <SiteFooter variant="default" />
    </div>
  )
}
