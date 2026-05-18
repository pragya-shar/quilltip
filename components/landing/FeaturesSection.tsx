'use client'

import {
  Edit3,
  DollarSign,
  Shield,
  Zap,
  MessageSquare,
  TrendingUp,
  Globe,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import { Reveal } from '@/components/landing/Reveal'
import { MIN_WITHDRAWAL_USD } from '@/lib/constants'
import { TESTNET_PRACTICE_NOTE } from '@/lib/copy/network-status'

interface Feature {
  icon: LucideIcon
  title: string
  description: string
}

const features: Feature[] = [
  {
    icon: Edit3,
    title: 'Rich Editor',
    description: 'Code blocks, media embeds, and full markdown support.',
  },
  {
    icon: DollarSign,
    title: 'Fast Testnet Tips',
    description:
      'Tips settle in about 3 seconds on Stellar testnet with near-zero fees.',
  },
  {
    icon: MessageSquare,
    title: 'Interactive Reading',
    description: 'Highlight passages and tip the words that move you.',
  },
  {
    icon: Shield,
    title: '100% Ownership',
    description: 'Your content, your rules. No platform lock-in.',
  },
  {
    icon: TrendingUp,
    title: 'Testnet Analytics',
    description:
      'Track testnet tip activity and audience growth as it happens.',
  },
  {
    icon: Zap,
    title: 'Withdraw Testnet Earnings',
    description: `Move testnet earnings to your wallet once your balance reaches $${MIN_WITHDRAWAL_USD.toFixed(0)}.`,
  },
  {
    icon: Globe,
    title: 'Permanent Storage',
    description: 'Articles stored forever on Arweave.',
  },
  {
    icon: Sparkles,
    title: 'NFT Minting',
    description: 'Mint top articles as collectible NFTs.',
  },
]

function FeatureRow({ feature }: { feature: Feature }) {
  return (
    <motion.div className="flex items-start gap-4">
      <div className="shrink-0 w-10 h-10 rounded-full bg-card border-2 border-border flex items-center justify-center">
        <feature.icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold text-foreground">
          {feature.title}
        </h3>
        <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
          {feature.description}
        </p>
      </div>
    </motion.div>
  )
}

export default function FeaturesSection() {
  return (
    <section
      id="features"
      className="scroll-mt-20 py-20 md:py-28 px-6 bg-gradient-to-b from-background via-muted/30 to-background relative overflow-hidden"
    >
      <div className="container mx-auto max-w-3xl relative z-10">
        <Reveal className="text-center mb-12">
          <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-3 leading-[1.15]">
            <span className="text-foreground">Core Features</span>
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            Everything writers and readers need on testnet.
          </p>
          <p className="text-[13px] text-muted-foreground leading-relaxed mt-2 max-w-lg mx-auto">
            {TESTNET_PRACTICE_NOTE}
          </p>
        </Reveal>

        <div className="md:hidden space-y-6">
          {features.map((feature, index) => (
            <Reveal key={feature.title} delay={0.05 + index * 0.05}>
              <FeatureRow feature={feature} />
            </Reveal>
          ))}
        </div>

        <div className="hidden md:block relative">
          <div
            className="absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-1/2"
            aria-hidden
          />
          <motion.div
            className="absolute left-1/2 top-0 bottom-0 w-px bg-brand -translate-x-1/2 origin-top"
            initial={{ scaleY: 0 }}
            whileInView={{ scaleY: 1 }}
            viewport={{ once: true, amount: 0.15, margin: '0px 0px -10% 0px' }}
            transition={{ duration: 1.5, delay: 0.3, ease: 'easeOut' }}
            aria-hidden
          />

          <div className="space-y-8">
            {features.map((feature, index) => {
              const isLeft = index % 2 === 0

              return (
                <Reveal
                  key={feature.title}
                  className="group relative flex items-center cursor-default"
                  delay={0.1 + index * 0.08}
                >
                  <div className="absolute left-1/2 -translate-x-1/2 z-10 w-10 h-10 rounded-full bg-card border-2 border-border group-hover:border-foreground group-hover:scale-110 flex items-center justify-center transition-all duration-300">
                    <feature.icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors duration-300" />
                  </div>

                  {isLeft ? (
                    <>
                      <div className="w-[calc(50%-36px)] text-right pr-2 group-hover:translate-x-[-4px] transition-transform duration-300">
                        <h3 className="text-[15px] font-semibold text-foreground">
                          {feature.title}
                        </h3>
                        <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
                          {feature.description}
                        </p>
                      </div>
                      <div className="w-[calc(50%+36px)]" aria-hidden />
                    </>
                  ) : (
                    <>
                      <div className="w-[calc(50%+36px)]" aria-hidden />
                      <div className="w-[calc(50%-36px)] pl-2 group-hover:translate-x-[4px] transition-transform duration-300">
                        <h3 className="text-[15px] font-semibold text-foreground">
                          {feature.title}
                        </h3>
                        <p className="text-[13px] text-muted-foreground leading-relaxed mt-0.5">
                          {feature.description}
                        </p>
                      </div>
                    </>
                  )}
                </Reveal>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
