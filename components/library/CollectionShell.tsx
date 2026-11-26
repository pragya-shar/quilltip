import AppNavigation from '@/components/layout/AppNavigation'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'

export function CollectionShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppNavigation />
      <div className="prototype-library pt-16" data-view="journal">
        <LandingOrnaments
          rootSelector=".prototype-library"
          count={15}
          trackContent
        />
        {children}
      </div>
    </>
  )
}
