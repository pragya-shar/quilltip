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
import { useState } from 'react'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingNavigation } from '@/components/landing/LandingNavigation'
import type { DemoReceipt } from '@/components/landing/LandingTippingDemo'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'
import { OpeningStage } from '@/components/landing/OpeningStage'
import { useLandingOpening } from '@/components/landing/useLandingOpening'

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
  const { active, finish } = useLandingOpening()
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null)

  return (
    <div
      className="landing-blend opening-trial onboarding-study blend-study rose-study type-study presentation-view scene-study connected-study guided-sequence stacked"
      data-onboarding="landing"
      data-typeface="syne"
      data-cinematic="true"
      data-opening-ready={!active}
      data-stage-active={active}
    >
      <div className="colour-field" aria-hidden />
      <LandingOrnaments />
      <div inert={active} aria-hidden={active || undefined}>
        <a className="skip-link" href="#try-it">
          Skip to the reading moment
        </a>
        <LandingNavigation />
        <main>
          <HeroSection ready={!active} onReceipt={setReceipt} />
          <LandingBelowFold receipt={receipt} />
        </main>
        <LandingFooter />
      </div>
      {active && <OpeningStage onFinish={finish} />}
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
