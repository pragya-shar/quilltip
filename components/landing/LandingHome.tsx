'use client'

import HeroSection from '@/components/landing/HeroSection'
import dynamic from 'next/dynamic'
import { useLandingHashScroll } from '@/components/landing/useLandingHashScroll'
import { useState } from 'react'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingNavigation } from '@/components/landing/LandingNavigation'
import type { DemoReceipt } from '@/components/landing/LandingTippingDemo'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'
import { OpeningStage } from '@/components/landing/OpeningStage'
import { useLandingOpening } from '@/components/landing/useLandingOpening'

const LandingBelowFold = dynamic(
  () => import('@/components/landing/LandingBelowFold'),
  { ssr: false }
)

export function LandingHome() {
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
