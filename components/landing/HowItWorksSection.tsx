'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { BookOpen, Wallet, Coins, ArrowRight, ChevronDown } from 'lucide-react'
import { motion, useInView } from 'motion/react'
import { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LandingTippingDemo } from '@/components/landing/LandingTippingDemo'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

interface Step {
  icon: LucideIcon
  title: string
  description: string
  detail: string
}

const stepTriggerFocusClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-spotlight'

const steps: Step[] = [
  {
    icon: BookOpen,
    title: 'Browse',
    description: 'Discover articles from writers across the platform',
    detail:
      'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.',
  },
  {
    icon: Wallet,
    title: 'Tip',
    description: 'Connect a Stellar wallet and tip your favorite passages',
    detail:
      "Install Freighter, fund with free testnet XLM, and send tips that settle in about 3 seconds.",
  },
  {
    icon: Coins,
    title: 'Publish & earn',
    description: 'Write, publish, and keep 97.5% of every tip',
    detail:
      'Use the rich editor to publish your work. Tips go directly to your wallet with near-zero fees.',
  },
]

export default function HowItWorksSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })

  return (
    <section
      id="how-it-works"
      className="py-16 px-6 bg-spotlight text-spotlight-foreground relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_color-mix(in_oklab,var(--spotlight-foreground)_6%,transparent)_0%,_transparent_60%)]" />

      <div className="container mx-auto max-w-7xl relative z-10" ref={ref}>
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-4 leading-[1.15] text-spotlight-foreground">
            How tipping works
          </h2>
          <p className="text-[15px] text-spotlight-muted max-w-lg leading-relaxed">
            Read for free, tip what moves you, or publish and earn — all on
            Stellar testnet.
          </p>
        </motion.div>

        <motion.div
          aria-label="How it works steps"
          className="max-w-3xl"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <Accordion
            type="single"
            collapsible
            defaultValue="how-it-works-0"
            className="space-y-3"
          >
            {steps.map((step, index) => (
              <AccordionItem
                key={step.title}
                value={`how-it-works-${index}`}
                className={cn(
                  'border-none rounded-2xl border transition-colors duration-200 overflow-hidden',
                  'border-foreground/[0.06] bg-foreground/[0.02]',
                  'data-[state=open]:border-foreground/15 data-[state=open]:bg-foreground/[0.04]'
                )}
              >
                <div>
                  <AccordionTrigger
                    showChevron={false}
                    className={cn(
                      'group w-full flex items-center gap-4 px-5 py-4 hover:no-underline',
                      stepTriggerFocusClass
                    )}
                  >
                    <div
                      className={cn(
                        'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
                        'bg-foreground/5 border border-foreground/[0.06]',
                        'group-data-[state=open]:bg-foreground/10 group-data-[state=open]:border-foreground/10'
                      )}
                      aria-hidden="true"
                    >
                      <ChevronDown className="w-4 h-4 text-spotlight-muted transition-transform duration-200 group-data-[state=open]:rotate-180" />
                    </div>

                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <step.icon
                        className="w-4.5 h-4.5 text-spotlight-muted flex-shrink-0"
                        aria-hidden="true"
                      />
                      <span className="font-display text-lg md:text-xl font-medium tracking-tight text-spotlight-foreground truncate">
                        {step.title}
                      </span>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="px-5 pb-5 pt-0">
                    <ul className="list-disc pl-5 space-y-2">
                      <li className="text-[14px] text-spotlight-foreground/85 leading-relaxed">
                        {step.description}
                      </li>
                      <li className="text-[13px] text-spotlight-muted leading-relaxed">
                        {step.detail}
                      </li>
                    </ul>
                  </AccordionContent>
                </div>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>

        <motion.div
          className="mt-12 flex justify-center"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <LandingTippingDemo />
        </motion.div>

        <motion.div
          className="mt-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <Link
            href="/register"
            className="focus-ring group inline-flex items-center justify-center gap-2 bg-card text-card-foreground px-6 py-2.5 rounded-lg text-[13px] font-medium hover:bg-muted transition-all duration-200"
          >
            Start Writing & Earning Today
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
