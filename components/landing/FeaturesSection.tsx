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
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useInView } from 'framer-motion'
import { useRef } from 'react'
import { LucideIcon } from 'lucide-react'

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
    title: 'Instant Tips',
    description: 'Payments in 3 seconds via Stellar with near-zero fees.',
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
    title: 'Real-Time Analytics',
    description: 'Track earnings and audience growth as it happens.',
  },
  {
    icon: Zap,
    title: 'Instant Withdrawals',
    description: 'Withdraw your earnings instantly. No thresholds.',
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

export default function FeaturesSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section
      id="features"
      className="py-32 px-6 bg-gradient-to-b from-background via-muted/30 to-background relative overflow-hidden"
    >
      <div className="container mx-auto max-w-3xl relative z-10" ref={ref}>
        {/* Header */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-3 leading-[1.15]">
            <span className="text-foreground">Core Features</span>
          </h2>
          <p className="text-[15px] text-muted-foreground leading-relaxed">
            Everything writers and readers need.
          </p>
        </motion.div>

        {/* Vertical timeline */}
        <div className="relative">
          {/* Center line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border -translate-x-1/2" />
          <motion.div
            className="absolute left-1/2 top-0 bottom-0 w-px bg-brand -translate-x-1/2 origin-top"
            initial={{ scaleY: 0 }}
            animate={isInView ? { scaleY: 1 } : { scaleY: 0 }}
            transition={{ duration: 1.5, delay: 0.3, ease: 'easeOut' }}
          />

          <div className="space-y-8">
            {features.map((feature, index) => {
              const isLeft = index % 2 === 0

              return (
                <motion.div
                  key={feature.title}
                  className="group relative flex items-center cursor-default"
                  initial={{ opacity: 0, y: 20 }}
                  animate={
                    isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }
                  }
                  transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
                >
                  {/* Center dot */}
                  <div className="absolute left-1/2 -translate-x-1/2 z-10 w-10 h-10 rounded-full bg-card border-2 border-border group-hover:border-foreground group-hover:scale-110 flex items-center justify-center transition-all duration-300">
                    <feature.icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors duration-300" />
                  </div>

                  {/* Content — alternating sides */}
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
                      <div className="w-[calc(50%+36px)]" />
                    </>
                  ) : (
                    <>
                      <div className="w-[calc(50%+36px)]" />
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
                </motion.div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
