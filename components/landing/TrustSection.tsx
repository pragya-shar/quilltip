'use client'

import { Shield } from 'lucide-react'
import { Reveal } from '@/components/landing/Reveal'
import { LandingHashLink } from '@/components/landing/LandingHashLink'
import { TESTNET_PRACTICE_NOTE } from '@/lib/copy/network-status'

const trustBullets = [
  'Tips move wallet-to-wallet on Stellar testnet through audited Soroban contracts',
  'Wallet apps like Freighter sign transactions locally on your device',
  'Writers keep 97.5% of every tip — fees enforced on-chain',
  'Published articles are stored on Arweave for long-term availability',
] as const

export default function TrustSection() {
  return (
    <section className="scroll-mt-20 py-20 md:py-28 px-6 bg-background border-t border-border/60">
      <div className="container mx-auto max-w-6xl">
        <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-4 leading-[1.15] text-foreground">
          Trust and permanence
        </h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-12 max-w-2xl">
          How Quilltip protects writers and readers on testnet.
        </p>

        <div className="flex items-center justify-center gap-8 sm:gap-12 mb-12">
          <div className="text-center">
            <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
              97.5%
            </p>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">
              To Authors
            </p>
          </div>
          <div className="w-px h-6 bg-border" />
          <div className="text-center">
            <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
              3s
            </p>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">
              Settlement
            </p>
          </div>
          <div className="w-px h-6 bg-border" />
          <div className="text-center">
            <p className="text-lg sm:text-xl font-semibold text-foreground tabular-nums">
              $0.01
            </p>
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest mt-0.5">
              Min Tip
            </p>
          </div>
        </div>

        <Reveal>
          <article
            id="security"
            className="scroll-mt-24 mx-auto rounded-2xl border border-border bg-card p-8 shadow-sm max-w-3xl"
          >
            <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center mb-5">
              <Shield className="w-5 h-5 text-foreground" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-3">
              <LandingHashLink
                href="#security"
                className="focus-ring rounded-sm hover:underline underline-offset-2"
              >
                Security on testnet
              </LandingHashLink>
            </h3>
            <p className="text-[14px] text-muted-foreground leading-relaxed mb-5">
              Quilltip never holds your funds. You approve every transaction in
              your own wallet app before it is sent.
            </p>
            <ul className="space-y-2 mb-5">
              {trustBullets.map((bullet) => (
                <li
                  key={bullet}
                  className="text-[13px] text-muted-foreground leading-relaxed flex gap-2"
                >
                  <span className="text-brand mt-1.5 shrink-0" aria-hidden>
                    •
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {TESTNET_PRACTICE_NOTE}
            </p>
          </article>
        </Reveal>
      </div>
    </section>
  )
}
