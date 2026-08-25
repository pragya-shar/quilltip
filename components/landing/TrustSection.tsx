'use client'

import { Shield } from 'lucide-react'
import { Reveal } from '@/components/landing/Reveal'
import { LandingHashLink } from '@/components/landing/LandingHashLink'
import {
  TRUST_BULLETS,
  TRUST_SECTION_HEADING,
  TRUST_SECTION_SUBHEAD,
  TRUST_SECURITY_HEADING,
  TRUST_SECURITY_INTRO,
} from '@/lib/copy/landing-sections'

export default function TrustSection() {
  return (
    <section className="scroll-mt-20 py-20 md:py-28 px-6 bg-background border-t border-border/60">
      <div className="container mx-auto max-w-6xl">
        <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-4 leading-[1.15] text-foreground">
          {TRUST_SECTION_HEADING}
        </h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-12 max-w-2xl">
          {TRUST_SECTION_SUBHEAD}
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
                {TRUST_SECURITY_HEADING}
              </LandingHashLink>
            </h3>
            <p className="text-[14px] text-muted-foreground leading-relaxed mb-5">
              {TRUST_SECURITY_INTRO}
            </p>
            <ul className="space-y-2">
              {TRUST_BULLETS.map((bullet) => (
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
          </article>
        </Reveal>
      </div>
    </section>
  )
}
