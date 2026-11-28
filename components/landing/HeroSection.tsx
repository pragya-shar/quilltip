'use client'

import Link from 'next/link'
import { ArrowRight } from './LandingIcons'
import { LandingTippingDemo, type DemoReceipt } from './LandingTippingDemo'
import { HandwrittenWord } from './OpeningInk'
import { usePaperArrival } from './usePaperArrival'

export default function HeroSection({
  ready = true,
  opening = false,
  onReceipt,
}: {
  ready?: boolean
  /**
   * The opening sequence is playing. The hero waits for it; the opening
   * offers its own reading link meanwhile (#598).
   */
  opening?: boolean
  onReceipt?: (receipt: DemoReceipt | null) => void
}) {
  const heroRef = usePaperArrival(ready)
  // Out of reach for the keyboard and assistive technology while it waits.
  const waiting = { inert: opening, 'aria-hidden': opening || undefined }

  return (
    <section
      ref={heroRef}
      className="hero"
      // Named by the headline, which waits during the opening.
      aria-labelledby={opening ? undefined : 'hero-title'}
    >
      <div className="hero-copy">
        <h1
          id="hero-title"
          {...waiting}
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
        <p className="supporting-copy" {...waiting}>
          Show the love you feel when words move you.
        </p>
        <div className="hero-actions" {...waiting}>
          <Link href="/articles" className="button primary">
            I’m here to read
            <ArrowRight size={18} aria-hidden />
          </Link>
          <Link href="/demo/write" className="button primary">
            I’m here to write
            <ArrowRight size={18} aria-hidden />
          </Link>
        </div>
        <p className="hero-wallet-note" {...waiting}>
          Read without a wallet. Tip with a Stellar wallet.
        </p>
      </div>
      <div className="landing-contents" {...waiting}>
        <LandingTippingDemo ready={ready} onReceipt={onReceipt} />
      </div>
    </section>
  )
}
