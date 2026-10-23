'use client'

import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import { OnboardingIntentHome } from '@/components/onboarding/OnboardingIntentHome'
import { LandingHome } from '@/components/landing/LandingHome'

export default function HomePage() {
  const { user, isAuthenticated, isLoading } = useAuth()

  const showOnboarding =
    !isLoading && isAuthenticated && user && !user.onboardingCompleted

  if (showOnboarding) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <OnboardingIntentHome />
      </div>
    )
  }

  return <LandingHome />
}
