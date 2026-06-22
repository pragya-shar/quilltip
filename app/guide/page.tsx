'use client'

import { SiteHeader } from '@/components/layout/SiteHeader'
import { WalletGuide } from '@/components/guide/WalletGuide'
import { SiteFooter } from '@/components/layout/SiteFooter'

export default function GuidePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <div className="flex-1 pt-24 pb-16 px-4">
        <WalletGuide />
      </div>
      <SiteFooter variant="default" />
    </div>
  )
}
