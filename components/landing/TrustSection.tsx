'use client'

import { Shield, Globe } from 'lucide-react'
import { Reveal } from '@/components/landing/Reveal'
import { LandingHashLink } from '@/components/landing/LandingHashLink'

const trustTopics = [
  {
    id: 'security',
    icon: Shield,
    title: 'Security on testnet',
    description:
      'Quilltip never holds your funds. Tips move wallet-to-wallet on Stellar testnet through audited Soroban contracts. You approve every transaction in your own wallet app before it is sent.',
    bullets: [
      'Practice with free testnet XLM only — no real money at risk',
      'Wallet apps like Freighter sign transactions locally on your device',
      'Platform fees are enforced on-chain, not by manual transfers',
    ],
  },
  {
    id: 'arweave-storage',
    icon: Globe,
    title: 'Permanent storage with Arweave',
    description:
      'Published articles are stored on Arweave, a decentralized network designed for permanent data. Your writing survives independently of Quilltip servers.',
    bullets: [
      'One-time upload — no recurring hosting bills for writers',
      'Readers access content through Quilltip while copies persist on Arweave',
      'Optional NFT minting adds an on-chain ownership record on Stellar',
    ],
  },
] as const

export default function TrustSection() {
  return (
    <section className="scroll-mt-20 py-20 md:py-28 px-6 bg-background border-t border-border/60">
      <div className="container mx-auto max-w-6xl">
        <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-4 leading-[1.15] text-foreground">
          Trust and permanence
        </h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-12 max-w-2xl">
          How Quilltip protects writers and readers on testnet, and how your
          articles stay available long term.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {trustTopics.map((topic, index) => (
            <Reveal key={topic.id} delay={index * 0.08}>
              <article
                id={topic.id}
                className="scroll-mt-24 h-full rounded-2xl border border-border bg-card p-8 shadow-sm"
              >
                <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center mb-5">
                  <topic.icon className="w-5 h-5 text-foreground" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-3">
                  <LandingHashLink
                    href={`#${topic.id}`}
                    className="focus-ring rounded-sm hover:underline underline-offset-2"
                  >
                    {topic.title}
                  </LandingHashLink>
                </h3>
                <p className="text-[14px] text-muted-foreground leading-relaxed mb-5">
                  {topic.description}
                </p>
                <ul className="space-y-2">
                  {topic.bullets.map((bullet) => (
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
          ))}
        </div>
      </div>
    </section>
  )
}
