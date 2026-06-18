'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  LANDING_HERO_HEADLINE,
  LANDING_HERO_SUBTITLE,
} from '@/lib/copy/landing-hero'
import { HERO_START_READING, HERO_START_WRITING } from '@/lib/copy/nav-cta'
import { LandingProductProof } from '@/components/landing/LandingProductProof'
import { LandingTippingDemo } from '@/components/landing/LandingTippingDemo'
import { motion } from 'motion/react'

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-start md:items-center justify-center overflow-hidden pt-16">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/30" />

      <div className="container mx-auto max-w-4xl px-6 relative z-10 py-10 sm:py-20">
        <motion.div
          className="flex flex-col items-center text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <motion.h1
            className="font-display text-4xl sm:text-[2.75rem] lg:text-5xl font-medium tracking-[-0.01em] text-foreground leading-[1.2]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05, ease: 'easeOut' }}
          >
            {LANDING_HERO_HEADLINE}
          </motion.h1>

          <motion.p
            className="mt-4 text-[15px] sm:text-base text-muted-foreground max-w-md leading-relaxed"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          >
            {LANDING_HERO_SUBTITLE}
          </motion.p>

          <motion.div
            className="mt-8 hidden w-full justify-center lg:flex"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: 'easeOut' }}
          >
            <LandingTippingDemo />
          </motion.div>

          <motion.div
            className="mt-6 flex w-full max-w-md flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' }}
          >
            <Link
              href="/articles"
              className="focus-ring group inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-6 py-2.5 text-[13px] font-medium text-brand-foreground transition-all duration-200 hover:bg-brand-hover hover:shadow-lg sm:w-auto"
            >
              {HERO_START_READING}
              <ArrowRight className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/register"
              className="focus-ring inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-6 py-2.5 text-[13px] font-medium text-foreground transition-all duration-200 hover:bg-muted sm:w-auto"
            >
              {HERO_START_WRITING}
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.25, ease: 'easeOut' }}
            className="mt-8 w-full flex justify-center opacity-90"
          >
            <LandingProductProof />
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
