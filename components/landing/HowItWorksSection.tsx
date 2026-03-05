'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  UserPlus,
  Edit3,
  Globe,
  Coins,
  ArrowRight,
  Sparkles,
  BookOpen,
  Highlighter,
  Wallet,
  Heart,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useInView } from 'framer-motion'
import { useRef } from 'react'
import { LucideIcon } from 'lucide-react'

interface Step {
  icon: LucideIcon
  title: string
  description: string
  detail: string
}

export default function HowItWorksSection() {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-100px' })
  const [activeTab, setActiveTab] = useState<'writers' | 'readers'>('writers')
  const [activeStep, setActiveStep] = useState(0)

  const writerSteps: Step[] = [
    {
      icon: UserPlus,
      title: 'Sign Up',
      description:
        'Create your account and connect your Stellar wallet in seconds',
      detail:
        'One-click registration with your email. Connect Freighter wallet to start receiving tips instantly.',
    },
    {
      icon: Edit3,
      title: 'Write',
      description:
        'Craft compelling content with our intuitive rich text editor',
      detail:
        'Full markdown support, code blocks, media embeds, and a distraction-free writing experience.',
    },
    {
      icon: Globe,
      title: 'Publish',
      description: 'Share your work with the world on the blockchain',
      detail:
        'Your article is stored permanently on Arweave. A tamper-proof record of your creative work, forever.',
    },
    {
      icon: Coins,
      title: 'Earn',
      description: 'Receive instant tips from readers who value your work',
      detail:
        'Tips settle in 3 seconds via Stellar. You keep 97.5% of every tip — no waiting periods.',
    },
  ]

  const readerSteps: Step[] = [
    {
      icon: BookOpen,
      title: 'Browse',
      description: 'Discover articles from writers across the platform',
      detail:
        'All articles are free to read. Explore by topic, trending, or latest. No paywalls, ever.',
    },
    {
      icon: Highlighter,
      title: 'Highlight',
      description: 'Select your favorite passages and save them',
      detail:
        'Mark the words that resonate with you. Add colors and notes to build your personal collection.',
    },
    {
      icon: Wallet,
      title: 'Connect',
      description: 'Set up a Stellar wallet in 2 minutes',
      detail:
        "Install Freighter, fund with free testnet XLM, and you're ready to tip your favorite writers.",
    },
    {
      icon: Heart,
      title: 'Tip',
      description: 'Send micro-tips starting at $0.01',
      detail:
        'Tip an article or a specific highlight. 97.5% goes directly to the author — near-zero fees.',
    },
  ]

  const steps = activeTab === 'writers' ? writerSteps : readerSteps

  const handleTabChange = (tab: 'writers' | 'readers') => {
    setActiveTab(tab)
    setActiveStep(0)
  }

  return (
    <section
      id="how-it-works"
      className="py-32 px-6 bg-neutral-950 relative overflow-hidden"
    >
      {/* Subtle background grain */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.03)_0%,_transparent_60%)]" />

      <div className="container mx-auto max-w-7xl relative z-10" ref={ref}>
        {/* Section Header */}
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8 }}
        >
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8">
            <div>
              <motion.div
                className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-sm rounded-full border border-white/10 mb-6"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={
                  isInView
                    ? { opacity: 1, scale: 1 }
                    : { opacity: 0, scale: 0.9 }
                }
                transition={{ duration: 0.5 }}
              >
                <Sparkles className="w-3.5 h-3.5 text-neutral-500" />
                <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                  Simple Process
                </span>
              </motion.div>

              <h2 className="font-display text-4xl lg:text-5xl font-medium tracking-[-0.01em] mb-4 leading-[1.15]">
                <span className="text-white">From idea to impact, </span>
                <span className="text-neutral-400 italic">in four steps.</span>
              </h2>
              <p className="text-[15px] text-neutral-500 max-w-lg leading-relaxed">
                Whether you write or read, Quilltip makes it simple to
                participate in the future of publishing.
              </p>
            </div>

            {/* Writer / Reader Toggle */}
            <div className="inline-flex items-center bg-white/5 rounded-lg p-1 border border-white/10 shrink-0">
              <button
                onClick={() => handleTabChange('writers')}
                className={`px-5 py-2 rounded-md text-[13px] font-medium transition-all duration-200 ${
                  activeTab === 'writers'
                    ? 'bg-white text-neutral-900 shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                For Writers
              </button>
              <button
                onClick={() => handleTabChange('readers')}
                className={`px-5 py-2 rounded-md text-[13px] font-medium transition-all duration-200 ${
                  activeTab === 'readers'
                    ? 'bg-white text-neutral-900 shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                For Readers
              </button>
            </div>
          </div>
        </motion.div>

        {/* Expandable Steps — Desktop */}
        <motion.div
          className="hidden md:flex gap-2 h-[340px]"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {steps.map((step, index) => {
            const isActive = activeStep === index
            return (
              <motion.div
                key={step.title}
                className={`relative rounded-2xl border cursor-pointer overflow-hidden transition-colors duration-300 ${
                  isActive
                    ? 'border-white/15 bg-white/[0.04]'
                    : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.03] hover:border-white/10'
                }`}
                animate={{ flex: isActive ? 3 : 1 }}
                transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                onMouseEnter={() => setActiveStep(index)}
              >
                {/* Collapsed state */}
                <AnimatePresence mode="wait">
                  {!isActive ? (
                    <motion.div
                      key="collapsed"
                      className="h-full flex flex-col items-center justify-center gap-4 px-4"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center">
                        <step.icon className="w-5 h-5 text-neutral-500" />
                      </div>
                      <span className="text-[15px] font-medium text-neutral-500 [writing-mode:vertical-lr] tracking-wide">
                        {step.title}
                      </span>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="expanded"
                      className="h-full flex flex-col justify-between p-8"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3, delay: 0.15 }}
                    >
                      <div>
                        {/* Icon + Title */}
                        <div className="flex items-center gap-4 mb-6">
                          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                            <step.icon className="w-6 h-6 text-white" />
                          </div>
                          <h3 className="text-3xl font-display font-medium text-white tracking-tight">
                            {step.title}
                          </h3>
                        </div>

                        {/* Description */}
                        <p className="text-[15px] text-neutral-300 leading-relaxed mb-3 max-w-md">
                          {step.description}
                        </p>
                        <p className="text-[13px] text-neutral-500 leading-relaxed max-w-md">
                          {step.detail}
                        </p>
                      </div>

                      {/* Step indicator dots */}
                      <div className="flex items-center gap-2">
                        {steps.map((_, i) => (
                          <div
                            key={i}
                            className={`h-1 rounded-full transition-all duration-300 ${
                              i === index ? 'w-8 bg-white' : 'w-2 bg-white/20'
                            }`}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </motion.div>

        {/* Steps — Mobile (vertical accordion) */}
        <motion.div
          className="md:hidden space-y-2"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          {steps.map((step, index) => {
            const isActive = activeStep === index
            return (
              <motion.div
                key={step.title}
                className={`rounded-2xl border overflow-hidden cursor-pointer transition-colors duration-300 ${
                  isActive
                    ? 'border-white/15 bg-white/[0.04]'
                    : 'border-white/[0.06] bg-white/[0.02]'
                }`}
                onClick={() => setActiveStep(index)}
              >
                {/* Header row */}
                <div className="flex items-center gap-4 p-5">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors duration-300 ${
                      isActive
                        ? 'bg-white/10 border border-white/10'
                        : 'bg-white/5 border border-white/[0.06]'
                    }`}
                  >
                    <step.icon
                      className={`w-5 h-5 transition-colors duration-300 ${isActive ? 'text-white' : 'text-neutral-500'}`}
                    />
                  </div>
                  <span
                    className={`text-[15px] font-medium transition-colors duration-300 ${isActive ? 'text-white' : 'text-neutral-500'}`}
                  >
                    {step.title}
                  </span>
                </div>

                {/* Expandable content */}
                <AnimatePresence>
                  {isActive && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                      <div className="px-5 pb-5 pl-20">
                        <p className="text-[14px] text-neutral-300 leading-relaxed mb-2">
                          {step.description}
                        </p>
                        <p className="text-[12px] text-neutral-500 leading-relaxed">
                          {step.detail}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </motion.div>

        {/* CTA */}
        <motion.div
          className="mt-16 text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8, delay: 0.8 }}
        >
          <Link
            href="/register"
            className="group inline-flex items-center justify-center gap-2 bg-white text-neutral-900 px-6 py-2.5 rounded-lg text-[13px] font-medium hover:bg-neutral-100 transition-all duration-200"
          >
            Start Writing & Earning Today
            <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform duration-200" />
          </Link>
        </motion.div>
      </div>
    </section>
  )
}
