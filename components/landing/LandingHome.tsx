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
// Loaded with the landing page only; the typefaces stay global (landing-fonts.css).
import '@/components/landing/landing-blend.css'

const LandingBelowFold = dynamic(
  () => import('@/components/landing/LandingBelowFold'),
  { ssr: false }
)

export function LandingHome() {
  useLandingHashScroll()
  const { active, finish } = useLandingOpening()
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null)
  // Out of reach for the keyboard and assistive technology while it waits.
  const waiting = { inert: active, 'aria-hidden': active || undefined }

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
      {/* While the opening plays, the page waits, part by part; the opening
          offers its own reading link meanwhile (#598). */}
      <div>
        <a className="skip-link" href="#try-it" {...waiting}>
          Skip to the reading moment
        </a>
        <div className="landing-contents" {...waiting}>
          <LandingNavigation />
        </div>
        <main>
          <HeroSection
            ready={!active}
            opening={active}
            onReceipt={setReceipt}
          />
          <div className="landing-contents" {...waiting}>
            <LandingBelowFold receipt={receipt} />
          </div>
        </main>
        <div className="landing-contents" {...waiting}>
          <LandingFooter />
        </div>
      </div>
      {active && <OpeningStage onFinish={finish} />}
    </div>
  )
}
