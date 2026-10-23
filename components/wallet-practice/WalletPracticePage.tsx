'use client'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { LandingNavigation } from '@/components/landing/LandingNavigation'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'
const WalletPreview = dynamic(
  () => import('./WalletPreview').then((m) => m.WalletPreview),
  { ssr: false, loading: () => <p role="status">Opening wallet practice…</p> }
)
export function WalletPracticePage() {
  const [sample, setSample] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  useEffect(() => {
    const update = () => setShowHelp(location.hash === '#wallet-help')
    update()
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return (
    <div
      className="prototype-wallet opening-trial onboarding-study blend-study rose-study type-study presentation-view scene-study connected-study guided-sequence stacked"
      data-onboarding="wallet"
      data-typeface="syne"
      data-cinematic="false"
      data-opening-ready="true"
      data-stage-active="false"
    >
      <div className="colour-field" aria-hidden />
      <LandingOrnaments />
      <LandingNavigation />
      <main>
        <div className="onboard-heading">
          <h1>
            {sample
              ? 'Explore a little appreciation.'
              : 'Try your first wallet transfer.'}
          </h1>
        </div>
        <div className="literary-features">
          <section className="features">
            <div className="feature-sequences">
              <div className="reader-chapter">
                <div>
                  <section
                    id="wallet-help"
                    className="wallet-practice-help"
                    aria-label="Wallet setup help"
                  >
                    <WalletSetupHelp receiving initiallyOpen={showHelp} />
                  </section>
                  <WalletPreview onModeChange={setSample} />
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}
