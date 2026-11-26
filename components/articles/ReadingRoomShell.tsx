import type { ReactNode } from 'react'
import AppNavigation from '@/components/layout/AppNavigation'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'

export function ReadingRoomShell({ children }: { children: ReactNode }) {
  return (
    <>
      <AppNavigation />
      <div className="reading-room pt-16">
        <LandingOrnaments rootSelector=".reading-room" count={15} />
        {children}
      </div>
    </>
  )
}
