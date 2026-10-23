'use client'

import Link from 'next/link'
import { ArrowRight } from './LandingIcons'
import { LandingTippingDemo, type DemoReceipt } from './LandingTippingDemo'
import { HandwrittenWord } from './OpeningInk'
import { usePaperArrival } from './usePaperArrival'

export default function HeroSection({
  ready = true,
  onReceipt,
}: {
  ready?: boolean
  onReceipt?: (receipt: DemoReceipt | null) => void
}) {
  const heroRef = usePaperArrival(ready)

  return (
    <section ref={heroRef} className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <h1
          id="hero-title"
          tabIndex={-1}
          className="value-headline"
          aria-label="Value for writing"
        >
          <span className="value-line" aria-hidden="true">
            Value for{' '}
            <span className="word-correction">
              <del>money</del>
              <span className="replacement-word">
                <HandwrittenWord />
              </span>
            </span>
          </span>
        </h1>
        <p className="supporting-copy">
          Show the love you feel when words move you.
        </p>
        <div className="hero-actions">
          <a href="/demos/read.html" className="button primary">
            I’m here to read
            <ArrowRight size={18} aria-hidden />
          </a>
          <Link href="/demo/write" className="button primary">
            I’m here to write
            <ArrowRight size={18} aria-hidden />
          </Link>
        </div>
        <p className="hero-wallet-note">
          Read without a wallet. Tip with a Stellar wallet.
        </p>
      </div>
      <LandingTippingDemo ready={ready} onReceipt={onReceipt} />
    </section>
  )
}
