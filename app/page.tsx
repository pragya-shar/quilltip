'use client'

import { useAuth } from '@/components/providers/AuthContext'
import AppNavigation from '@/components/layout/AppNavigation'
import HeroSection from '@/components/landing/HeroSection'

import dynamic from 'next/dynamic'

const LandingBelowFold = dynamic(
  () => import('@/components/landing/LandingBelowFold'),
  { ssr: false }
)
import { useLandingHashScroll } from '@/components/landing/useLandingHashScroll'
import { OnboardingIntentHome } from '@/components/onboarding/OnboardingIntentHome'
import {
  CreatorWorkspace,
  CreatorWorkspaceLoadingShell,
} from '@/components/dashboard/CreatorWorkspace'
import Navigation from '@/components/landing/Navigation'

function HomeLoadingShell() {
  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <div className="mx-auto max-w-6xl px-4 pt-24 pb-8">
        <CreatorWorkspaceLoadingShell />
      </div>
    </div>
  )
}

function PublicLandingPage() {
  useLandingHashScroll()

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-muted/30 to-background">
      <Navigation />
      <HeroSection />
      <LandingBelowFold />
    </div>
  )
}

export default function HomePage() {
  const { user, isAuthenticated, isLoading } = useAuth()

  const showOnboarding = isAuthenticated && user && !user.onboardingCompleted

  if (isAuthenticated && isLoading) {
    return <HomeLoadingShell />
  }

  if (isAuthenticated && user) {
    if (showOnboarding) {
      return (
        <div className="min-h-screen bg-background">
          <AppNavigation />
          <OnboardingIntentHome />
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <div className="mx-auto max-w-6xl px-4 pt-24 pb-8">
          <CreatorWorkspace user={user} />
        </div>
      </div>
    )
  }

  return <PublicLandingPage />
}
